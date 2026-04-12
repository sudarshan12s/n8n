import type { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { createVectorStoreNode, metadataFilterField } from '@n8n/ai-utilities';
import { DistanceStrategy, OracleVS, type OracleDBVSArgs } from '@oracle/langchain-oracledb';
import type oracledb from 'oracledb';
import type { OracleDBNodeCredentials } from 'n8n-nodes-base/dist/nodes/Oracle/Sql/helpers/interfaces';
import { configureOracleDB } from 'n8n-nodes-base/dist/nodes/Oracle/Sql/transport';
import type { IExecuteFunctions, INodeProperties, ISupplyDataFunctions } from 'n8n-workflow';

const sharedFields: INodeProperties[] = [
	{
		displayName: 'Table Name',
		name: 'tableName',
		type: 'string',
		default: 'n8n_vectors',
		description:
			'The table name to store the vectors in. If table does not exist, it will be created.',
	},
];

const distanceStrategyField: INodeProperties = {
	displayName: 'Distance Strategy',
	name: 'distanceStrategy',
	type: 'options',
	default: 'cosine',
	description: 'The method to calculate the distance between two vectors',
	options: [
		{
			name: 'Cosine',
			value: DistanceStrategy.COSINE,
		},
		{
			name: 'Inner Product',
			value: DistanceStrategy.DOT_PRODUCT,
		},
		{
			name: 'Euclidean',
			value: DistanceStrategy.EUCLIDEAN,
		},
		{
			name: 'Manhattan',
			value: DistanceStrategy.MANHATTAN,
		},
		{
			name: 'Euclidean Squared',
			value: DistanceStrategy.EUCLIDEAN_SQUARED,
		},
		{
			name: 'Hamming',
			value: DistanceStrategy.HAMMING,
		},
	],
};

const retrieveFields: INodeProperties[] = [
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		options: [distanceStrategyField, metadataFilterField],
	},
];

class LazyOraclePool {
	constructor(private readonly getPool: () => Promise<oracledb.Pool>) {}

	async getConnection(): Promise<oracledb.Connection> {
		const pool = await this.getPool();
		return await pool.getConnection();
	}

	async close(): Promise<void> {
		// ConnectionPoolManager owns lifecycle; keep the shared pool alive.
	}
}

const createLazyOraclePool = (
	context: IExecuteFunctions | ISupplyDataFunctions,
	credentials: OracleDBNodeCredentials,
) => {
	const getPool = async () => await configureOracleDB.call(context, credentials);
	return new LazyOraclePool(getPool) as unknown as oracledb.Pool;
};

/**
 * Extends OracleVS so retriever calls merge the node-level filter
 * with any ad-hoc filter provided at runtime.
 */
class ExtendedOracleDBVectorStore extends OracleVS {
	static async initialize(
		embeddings: EmbeddingsInterface,
		args: OracleDBVSArgs,
	): Promise<ExtendedOracleDBVectorStore> {
		const oracleDBVectorStore = new this(embeddings, args);

		await oracleDBVectorStore.initialize();
		return oracleDBVectorStore;
	}

	async similaritySearchVectorWithScore(
		query: number[],
		k: number,
		filter?: OracleVS['FilterType'],
	) {
		const mergedFilter = { ...this.filter, ...filter };
		return await super.similaritySearchVectorWithScore(query, k, mergedFilter);
	}
}

export class VectorStoreOracleDB extends createVectorStoreNode<ExtendedOracleDBVectorStore>({
	meta: {
		description: 'Work with your data in OracleDB vector support',
		icon: 'file:../shared/icons/oracle.svg',
		displayName: 'Oracle Database Vector Store',
		docsUrl:
			'https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.vectorstoreoracledb/',
		name: 'vectorStoreOracleDBVector',
		credentials: [
			{
				name: 'oracleDBApi',
				required: true,
				testedBy: 'oracleDBConnectionTest',
			},
		],
		operationModes: ['load', 'insert', 'retrieve', 'retrieve-as-tool', 'update'],
	},
	sharedFields,
	loadFields: retrieveFields,
	retrieveFields,
	async getVectorStoreClient(
		context: IExecuteFunctions | ISupplyDataFunctions,
		filter: Record<string, never> | undefined,
		embeddings: EmbeddingsInterface,
		itemIndex: number,
	): Promise<ExtendedOracleDBVectorStore> {
		const tableName = context.getNodeParameter('tableName', itemIndex, '', {
			extractValue: true,
		}) as string;
		const credentials = (await context.getCredentials('oracleDBApi')) as OracleDBNodeCredentials;
		const client = createLazyOraclePool(context, credentials);
		const query = '';
		const config: OracleDBVSArgs = {
			client,
			tableName,
			query,
			filter: filter as ExtendedOracleDBVectorStore['FilterType'] | undefined,
		};

		config.distanceStrategy = context.getNodeParameter(
			'options.distanceStrategy',
			0,
			DistanceStrategy.COSINE,
		) as DistanceStrategy;

		const vectorStore = await ExtendedOracleDBVectorStore.initialize(embeddings, config);
		const mode = context.getNodeParameter('mode', itemIndex, 'retrieve', {
			extractValue: true,
		}) as string;
		if (mode === 'update') {
			const originalAddDocuments = vectorStore.addDocuments.bind(vectorStore);
			vectorStore.addDocuments = async (
				documents,
				options,
			): Promise<Awaited<ReturnType<typeof originalAddDocuments>>> =>
				await originalAddDocuments(documents, { mutateOnDuplicate: true, ...options });
		}

		return vectorStore;
	},

	async populateVectorStore(
		context: IExecuteFunctions | ISupplyDataFunctions,
		embeddings: EmbeddingsInterface,
		documents: Array<Document<Record<string, unknown>>>,
		itemIndex: number,
	): Promise<void> {
		const tableName = context.getNodeParameter('tableName', itemIndex, '', {
			extractValue: true,
		}) as string;
		const credentials = (await context.getCredentials('oracleDBApi')) as OracleDBNodeCredentials;
		const client = createLazyOraclePool(context, credentials);
		const query = 'Test';
		const config: OracleDBVSArgs = {
			client,
			tableName,
			query,
		};

		await OracleVS.fromDocuments(documents, embeddings, config);
	},

	releaseVectorStoreClient(vectorStore) {
		const pool = vectorStore.client;
		if (pool && typeof pool.close === 'function') {
			void pool.close().catch(() => {});
		}
	},
}) {}
