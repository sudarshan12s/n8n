// cspell:ignore langchain oracledb ONNX MINILM
import { Embeddings } from '@langchain/core/embeddings';
import { getConnectionHintNoticeField, logWrapper } from '@n8n/ai-utilities';
import { OracleEmbeddings } from '@oracle/langchain-oracledb';
import { configureOracleDB } from 'n8n-nodes-base/dist/nodes/Oracle/Sql/transport';
import type { OracleDBNodeCredentials } from 'n8n-nodes-base/nodes/Oracle/Sql/helpers/interfaces';
import {
	NodeOperationError,
	NodeConnectionTypes,
	type INode,
	type INodeProperties,
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';
import type oracledb from 'oracledb';

import { searchModels } from './listModels';

export const generationFields: INodeProperties[] = [
	{
		displayName: 'Model',
		name: 'model',
		type: 'resourceLocator',
		default: { mode: 'list', value: 'ALL_MINILM_L12_V2' },
		required: true,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a model...',
				typeOptions: {
					searchListMethod: 'searchModels',
					searchable: true,
				},
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'ALL_MINILM_L12_V2',
			},
		],
		description: 'The model. Choose from the list, or specify an ID.',
	},
];

class PooledOracleEmbeddings extends Embeddings {
	constructor(
		private readonly getPool: () => Promise<oracledb.Pool>,
		private readonly pref: Record<string, unknown>,
		private readonly node: INode,
		private readonly itemIndex: number,
	) {
		super({});
	}

	private async withConnection<T>(
		executor: (embeddings: OracleEmbeddings) => Promise<T>,
	): Promise<T> {
		const pool = await this.getPool();
		const connection = await pool.getConnection();
		try {
			const embeddings = new OracleEmbeddings(connection, this.pref);
			return await executor(embeddings);
		} finally {
			await connection.close();
		}
	}

	private ensureFiniteNumber({
		value,
		vectorIndex,
		valueIndex,
	}: {
		value: unknown;
		vectorIndex: number;
		valueIndex: number;
	}): number {
		if (typeof value === 'number' && Number.isFinite(value)) return value;

		throw new NodeOperationError(this.node, 'Oracle embeddings returned a non-numeric value.', {
			itemIndex: this.itemIndex,
			description: `Expected a finite number at vector ${vectorIndex}, position ${valueIndex}, received ${typeof value}.`,
		});
	}

	private ensureEmbeddingVector(vector: unknown, vectorIndex: number): number[] {
		if (!Array.isArray(vector)) {
			throw new NodeOperationError(
				this.node,
				'Oracle embeddings returned an invalid embedding vector.',
				{
					itemIndex: this.itemIndex,
					description: `Expected an array for vector ${vectorIndex}, received ${typeof vector}.`,
				},
			);
		}

		return vector.map((value, valueIndex) =>
			this.ensureFiniteNumber({ value, vectorIndex, valueIndex }),
		);
	}

	private ensureEmbeddingMatrix(matrix: unknown): number[][] {
		if (!Array.isArray(matrix)) {
			throw new NodeOperationError(
				this.node,
				'Oracle embeddings returned malformed document embeddings.',
				{
					itemIndex: this.itemIndex,
					description: `Expected an array of vectors, received ${typeof matrix}.`,
				},
			);
		}

		return matrix.map((vector, index) => this.ensureEmbeddingVector(vector, index));
	}

	override async embedDocuments(documents: string[]): Promise<number[][]> {
		return await this.withConnection<number[][]>(async (embeddings) => {
			const rawEmbeddings: unknown = await embeddings.embedDocuments(documents);
			return this.ensureEmbeddingMatrix(rawEmbeddings);
		});
	}

	override async embedQuery(document: string): Promise<number[]> {
		return await this.withConnection<number[]>(async (embeddings) => {
			const rawEmbedding: unknown = await embeddings.embedQuery(document);
			return this.ensureEmbeddingVector(rawEmbedding, 0);
		});
	}
}

export class EmbeddingsOracleDb implements INodeType {
	methods = {
		listSearch: {
			searchModels,
		},
	};
	description: INodeTypeDescription = {
		displayName: 'Embeddings Oracle Database',
		name: 'embeddingsOracleDb',
		icon: 'file:../../shared/icons/oracle.svg',
		group: ['transform'],
		version: 1,
		description: 'Use ONNX Embeddings',
		defaults: {
			name: 'Embeddings ONNX',
		},
		credentials: [
			{
				name: 'oracleDBApi',
				required: true,
			},
		],
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Embeddings'],
			},
			resources: {
				primaryDocumentation: [
					{
						url: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/vecse/import-onnx-models-oracle-ai-database-end-end-example.html',
					},
				],
			},
		},

		inputs: [],

		outputs: [NodeConnectionTypes.AiEmbedding],
		outputNames: ['Embeddings'],
		properties: [
			getConnectionHintNoticeField([NodeConnectionTypes.AiVectorStore]),
			...generationFields,
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		this.logger.debug('Supply data for ONNX embeddings Oracle');
		const modelName = this.getNodeParameter('model', itemIndex, '', {
			extractValue: true,
		}) as string;

		const credentials = await this.getCredentials('oracleDBApi');
		const pref = {
			provider: 'database',
			model: modelName,
		};
		const node = this.getNode();
		const getPool = async () =>
			await configureOracleDB.call(this, credentials as OracleDBNodeCredentials);
		const embeddings = new PooledOracleEmbeddings(getPool, pref, node, itemIndex);

		return {
			response: logWrapper(embeddings, this),
		};
	}
}
