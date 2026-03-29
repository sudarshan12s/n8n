import type { Embeddings } from '@langchain/core/embeddings';
import type { Document } from '@langchain/core/documents';
import { DistanceStrategy, OracleVS, type OracleDBVSArgs } from '@oracle/langchain-oracledb';
import type { OracleDBNodeCredentials } from 'n8n-nodes-base/dist/nodes/Oracle/Sql/helpers/interfaces';
import { configureOracleDB } from 'n8n-nodes-base/dist/nodes/Oracle/Sql/transport';
import type { IExecuteFunctions, INodeProperties, ISupplyDataFunctions } from 'n8n-workflow';

import { createVectorStoreNode, metadataFilterField } from '@n8n/ai-utilities';
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

class ExtendedOracleDBVectorStore extends OracleVS {
	static async initialize(
		embeddings: Embeddings,
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
		icon: 'file:oracle.svg',
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
		operationModes: ['load', 'insert', 'retrieve', 'retrieve-as-tool'],
	},
	sharedFields,
	loadFields: retrieveFields,
	retrieveFields,
	async getVectorStoreClient(
		context: IExecuteFunctions | ISupplyDataFunctions,
		filter: Record<string, never> | undefined,
		embeddings: Embeddings,
		itemIndex: number,
	): Promise<ExtendedOracleDBVectorStore> {
		const tableName = context.getNodeParameter('tableName', itemIndex, '', {
			extractValue: true,
		}) as string;
		const credentials = await context.getCredentials('oracleDBApi');
		const client = await configureOracleDB.call(context, credentials as OracleDBNodeCredentials);
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

		return await ExtendedOracleDBVectorStore.initialize(embeddings, config);
	},

	async populateVectorStore(
		context: IExecuteFunctions | ISupplyDataFunctions,
		embeddings: Embeddings,
		documents: Array<Document<Record<string, unknown>>>,
		itemIndex: number,
	): Promise<void> {
		const tableName = context.getNodeParameter('tableName', itemIndex, '', {
			extractValue: true,
		}) as string;
		const credentials = await context.getCredentials('oracleDBApi');
		const client = await configureOracleDB.call(context, credentials as OracleDBNodeCredentials);
		const query = 'Test';
		const config: OracleDBVSArgs = {
			client,
			tableName,
			query,
		};

		await OracleVS.fromDocuments(documents, embeddings, config);
	},
}) {}
