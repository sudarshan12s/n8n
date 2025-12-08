import { OracleEmbeddings } from '@langchain/oracle';
import { configureOracleDB } from 'n8n-nodes-base/dist/nodes/Oracle/Sql/transport';
import type { OracleDBNodeCredentials } from 'n8n-nodes-base/nodes/Oracle/Sql/helpers/interfaces';
import type {
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { logWrapper } from '@utils/logWrapper';
import { getConnectionHintNoticeField } from '@utils/sharedFields';

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

export class EmbeddingsOracleDb implements INodeType {
	methods = {
		listSearch: {
			searchModels,
		},
	};
	description: INodeTypeDescription = {
		displayName: 'Embeddings Oracle DB',
		name: 'embeddingsOracleDb',
		icon: 'file:oracle.svg',
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
		const modelName = this.getNodeParameter('model', itemIndex) as string;
		const credentials = await this.getCredentials('oracleDBApi');
		const pool = await configureOracleDB.call(this, credentials as OracleDBNodeCredentials);

		const connection = await pool.getConnection();
		try {
			const pref = {
				provider: 'database',
				model: modelName.value,
			};
			const embeddings = new OracleEmbeddings(connection, pref);
			//const docEmbeddings = await embeddings.embedDocuments(texts);
			//await connection.close();

			return {
				response: logWrapper(embeddings, this),
			};
		} finally {
			//await connection?.close();
		}
		// Fix it
	}
}
