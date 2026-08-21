import { OciGenAiEmbeddings } from '@oracle/langchain-oci';
import { logWrapper } from '@n8n/ai-utilities';
import {
	NodeConnectionTypes,
	type IDataObject,
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';
import { models } from 'oci-generativeaiinference';

import { createOciGenAiClient, type OciGenAiCredentials } from '../../utils/ociGenAi';

const DEFAULT_MODEL = 'cohere.embed-v4.0';

export class EmbeddingsOciGenAi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Embeddings OCI Generative AI',
		name: 'embeddingsOciGenAi',
		icon: 'file:ociGenAi.svg',
		group: ['transform'],
		version: 1,
		description: 'Generate embeddings using OCI Generative AI',
		defaults: {
			name: 'Embeddings OCI Generative AI',
		},

		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Embeddings'],
			},
			resources: {
				primaryDocumentation: [
					{
						url: 'https://docs.oracle.com/en-us/iaas/Content/generative-ai/home.htm',
					},
				],
			},
		},

		credentials: [
			{
				name: 'ociGenAiApi',
				required: true,
			},
		],

		inputs: [],

		outputs: [NodeConnectionTypes.AiEmbedding],

		outputNames: ['Embeddings'],

		properties: [
			{
				displayName: 'Model',
				name: 'model',
				type: 'string',
				default: DEFAULT_MODEL,
				required: true,
				placeholder: 'cohere.embed-v4.0',
				description: 'OCI Generative AI embedding model ID',
			},
			{
				displayName: 'Compartment OCID',
				name: 'compartmentId',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'ocid1.compartment.oc1..aaaa...',
				description: 'OCID of the compartment used for the OCI Generative AI request',
			},
			{
				displayName: 'Serving Mode',
				name: 'servingMode',
				type: 'options',
				options: [
					{
						name: 'On Demand',
						value: 'onDemand',
					},
					{
						name: 'Dedicated Endpoint',
						value: 'dedicated',
					},
				],
				default: 'onDemand',
			},
			{
				displayName: 'Dedicated Endpoint ID',
				name: 'dedicatedEndpointId',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						servingMode: ['dedicated'],
					},
				},
				placeholder: 'ocid1.generativeaidededicatedaiendpoint.oc1...',
				description: 'OCID of the OCI dedicated AI endpoint',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Batch Size',
						name: 'batchSize',
						type: 'number',
						default: 96,
						typeOptions: {
							minValue: 1,
							maxValue: 96,
						},
						description: 'Maximum number of inputs per OCI request',
					},
					{
						displayName: 'Maximum Concurrency',
						name: 'maxConcurrency',
						type: 'number',
						default: 2,
						typeOptions: {
							minValue: 1,
						},
						description: 'Maximum number of concurrent OCI embedding requests',
					},
					{
						displayName: 'Output Dimensions',
						name: 'outputDimensions',
						type: 'number',
						default: 1024,
						typeOptions: {
							minValue: 1,
						},
						description: 'Output vector dimensions for compatible models',
					},
					{
						displayName: 'Truncate',
						name: 'truncate',
						type: 'options',
						options: [
							{
								name: 'None',
								value: 'NONE',
							},
							{
								name: 'Start',
								value: 'START',
							},
							{
								name: 'End',
								value: 'END',
							},
						],
						default: 'START',
						description: 'How OCI handles input exceeding the model token limit',
					},
				],
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = (await this.getCredentials('ociGenAiApi')) as OciGenAiCredentials;

		const model = this.getNodeParameter('model', itemIndex) as string;

		const compartmentId = this.getNodeParameter('compartmentId', itemIndex) as string;

		const servingMode = this.getNodeParameter('servingMode', itemIndex, 'onDemand') as
			| 'onDemand'
			| 'dedicated';

		const dedicatedEndpointId = this.getNodeParameter(
			'dedicatedEndpointId',
			itemIndex,
			'',
		) as string;

		const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

		const client = await createOciGenAiClient(credentials);

		const embeddings = new OciGenAiEmbeddings({
			client,

			compartmentId: compartmentId.trim(),

			...(servingMode === 'dedicated'
				? {
						dedicatedEndpointId: dedicatedEndpointId.trim(),
					}
				: {
						onDemandModelId: model.trim(),
					}),

			batchSize: typeof options.batchSize === 'number' ? options.batchSize : undefined,

			maxConcurrency:
				typeof options.maxConcurrency === 'number' ? options.maxConcurrency : undefined,

			outputDimensions:
				typeof options.outputDimensions === 'number' ? options.outputDimensions : undefined,

			truncate:
				typeof options.truncate === 'string'
					? (options.truncate as models.EmbedTextDetails.Truncate)
					: undefined,
		});

		return {
			response: logWrapper(embeddings, this),
		};
	}
}
