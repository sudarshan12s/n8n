// cspell:ignore langchain oracledb ONNX MINILM
import { Embeddings } from '@langchain/core/embeddings';
import { getConnectionHintNoticeField, logWrapper } from '@n8n/ai-utilities';
import { OracleEmbeddings } from '@oracle/langchain-oracledb';
import { configureOracleDB } from 'n8n-nodes-base/dist/nodes/Oracle/Sql/transport';
import type { OracleDBNodeCredentials } from 'n8n-nodes-base/nodes/Oracle/Sql/helpers/interfaces';
import {
	NodeConnectionTypes,
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
		private readonly pool: oracledb.Pool,
		private readonly pref: Record<string, unknown>,
		private readonly proxy?: string,
	) {
		super({});
	}

	private async withConnection<T>(
		executor: (embeddings: OracleEmbeddings) => Promise<T>,
	): Promise<T> {
		const connection = await this.pool.getConnection();
		try {
			const embeddings = new OracleEmbeddings(connection, this.pref, this.proxy);
			return await executor(embeddings);
		} finally {
			await connection.close();
		}
	}

	override async embedDocuments(documents: string[]): Promise<number[][]> {
		const result = await this.withConnection(
			async (embeddings) => await embeddings.embedDocuments(documents),
		);
		return result as number[][];
	}

	override async embedQuery(document: string): Promise<number[]> {
		const result = await this.withConnection(
			async (embeddings) => await embeddings.embedQuery(document),
		);
		return result as number[];
	}
}

export class EmbeddingsOracleDb implements INodeType {
	methods = {
		listSearch: {
			searchModels,
		},
	};
	description: INodeTypeDescription = {
		displayName: 'Embeddings Oracle DB',
		name: 'embeddingsOracleDb',
		icon: 'file:../shared/icons/oracle.svg',
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
						url: 'https://docs.oracle.com/en/database/oracle/oracle-database/23/vecse/import-onnx-models-oracle-database-end-end-example.html',
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
		this.logger.debug('Supply data for embeddings Oracle');
		const modelParam = this.getNodeParameter('model', itemIndex) as string | { value: string };
		const modelName = typeof modelParam === 'string' ? modelParam : modelParam.value;

		const credentials = await this.getCredentials('oracleDBApi');
		const pool = await configureOracleDB.call(this, credentials as OracleDBNodeCredentials);

		const pref = {
			provider: 'database',
			model: modelName,
		};
		const embeddings = new PooledOracleEmbeddings(pool, pref);

		return {
			response: logWrapper(embeddings, this),
		};
	}
}
