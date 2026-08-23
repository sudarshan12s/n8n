import { logWrapper } from '@n8n/ai-utilities';
import { OciGenAiEmbeddings } from '@oracle/langchain-oci';
import { models as ociModels } from 'oci-generativeaiinference';
import {
	NodeConnectionTypes,
	NodeOperationError,
	type ILoadOptionsFunctions,
	type INodeListSearchItems,
	type INodeListSearchResult,
	type INodeProperties,
	type INode,
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';

import { createOciGenAiClient, isOciGenAiCredentials } from '../../../utils/ociGenAi';

const DEFAULT_BATCH_SIZE = 96;
const DEFAULT_MAX_CONCURRENCY = 2;

type OnDemandEmbeddingModel = {
	displayName: string;
	modelId: string;
	regions: string[];
};

// Inference requires provider model IDs; ListModels returns management resource IDs.
const ON_DEMAND_EMBEDDING_MODELS: OnDemandEmbeddingModel[] = [
	{
		displayName: 'Cohere Embed 4',
		modelId: 'cohere.embed-v4.0',
		regions: ['us-ashburn-1', 'us-chicago-1', 'me-abudhabi-1', 'me-riyadh-1', 'ap-osaka-1'],
	},
	{
		displayName: 'Cohere Embed English 3',
		modelId: 'cohere.embed-english-v3.0',
		regions: ['us-chicago-1', 'sa-saopaulo-1', 'eu-frankfurt-1', 'uk-london-1', 'ap-osaka-1'],
	},
	{
		displayName: 'Cohere Embed English Light 3',
		modelId: 'cohere.embed-english-light-v3.0',
		regions: ['us-chicago-1'],
	},
	{
		displayName: 'Cohere Embed Multilingual 3',
		modelId: 'cohere.embed-multilingual-v3.0',
		regions: ['us-chicago-1', 'sa-saopaulo-1', 'eu-frankfurt-1', 'uk-london-1', 'ap-osaka-1'],
	},
	{
		displayName: 'Cohere Embed Multilingual Light 3',
		modelId: 'cohere.embed-multilingual-light-v3.0',
		regions: ['us-chicago-1'],
	},
];

type ResourceLocatorValue = {
	mode: string;
	value: string;
};

function isResourceLocatorValue(value: unknown): value is ResourceLocatorValue {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	return typeof candidate.mode === 'string' && typeof candidate.value === 'string';
}

function getModelId(node: INode, value: unknown, itemIndex?: number): string {
	if (isResourceLocatorValue(value)) {
		const modelId = value.value.trim();
		if (!modelId) {
			throw new NodeOperationError(node, 'Model is required', { itemIndex });
		}
		return modelId;
	}

	if (typeof value === 'string') {
		const modelId = value.trim();
		if (!modelId) {
			throw new NodeOperationError(node, 'Model is required', { itemIndex });
		}
		return modelId;
	}

	throw new NodeOperationError(node, 'Invalid model value provided', { itemIndex });
}

function getTruncate(value: unknown): ociModels.EmbedTextDetails.Truncate | undefined {
	switch (value) {
		case 'NONE':
			return ociModels.EmbedTextDetails.Truncate.None;
		case 'START':
			return ociModels.EmbedTextDetails.Truncate.Start;
		case 'END':
			return ociModels.EmbedTextDetails.Truncate.End;
		default:
			return undefined;
	}
}
const modelProperty: INodeProperties = {
	displayName: 'Model',
	name: 'model',
	type: 'resourceLocator',
	default: {
		mode: 'list',
		value: '',
	},
	required: true,
	displayOptions: {
		show: {
			servingMode: ['onDemand'],
		},
	},
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			placeholder: 'Select an embedding model...',
			typeOptions: {
				searchListMethod: 'searchEmbeddingModels',
				searchable: true,
			},
		},
		{
			displayName: 'ID',
			name: 'id',
			type: 'string',
			placeholder: 'cohere.embed-v4.0',
		},
	],
	description: 'The on-demand OCI Generative AI embedding model',
};

const compartmentProperty: INodeProperties = {
	displayName: 'Compartment OCID',
	name: 'compartmentId',
	type: 'string',
	default: '',
	required: true,
	placeholder: 'ocid1.compartment.oc1..aaaa...',
	description: 'OCID of the compartment authorized to use OCI Generative AI',
};

const servingModeProperty: INodeProperties = {
	displayName: 'Serving Mode',
	name: 'servingMode',
	type: 'options',
	options: [
		{
			name: 'On Demand',
			value: 'onDemand',
			description: 'Use an on-demand OCI Generative AI model',
		},
		{
			name: 'Dedicated Endpoint',
			value: 'dedicated',
			description: 'Use a model deployed to an OCI Generative AI dedicated endpoint',
		},
	],
	default: 'onDemand',
};

const dedicatedEndpointProperty: INodeProperties = {
	displayName: 'Dedicated Endpoint ID',
	name: 'dedicatedEndpointId',
	type: 'string',
	default: '',
	placeholder: 'ocid1.generativeaidededicatedaiendpoint.oc1...',
	displayOptions: {
		show: {
			servingMode: ['dedicated'],
		},
	},
	description: 'OCID of the dedicated AI endpoint hosting the embedding model',
};

const optionsProperty: INodeProperties = {
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
			default: DEFAULT_BATCH_SIZE,
			typeOptions: {
				minValue: 1,
				maxValue: 96,
			},
			description: 'Maximum number of texts included in one OCI embedding request',
		},
		{
			displayName: 'Maximum Concurrency',
			name: 'maxConcurrency',
			type: 'number',
			default: DEFAULT_MAX_CONCURRENCY,
			typeOptions: {
				minValue: 1,
			},
			description: 'Maximum number of embedding requests that can run concurrently',
		},
		{
			displayName: 'Output Dimensions',
			name: 'outputDimensions',
			type: 'number',
			default: 1024,
			typeOptions: {
				minValue: 1,
			},
			description: 'Optional output-vector dimension supported by compatible embedding models',
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
			description: 'How OCI should handle input that exceeds the model token limit',
		},
	],
};

export class EmbeddingsOciGenAi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Embeddings OCI Generative AI',
		name: 'embeddingsOciGenAi',
		icon: 'file:../../shared/icons/oracle.svg',
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
			modelProperty,
			compartmentProperty,
			servingModeProperty,
			dedicatedEndpointProperty,
			optionsProperty,
		],
	};

	methods = {
		listSearch: {
			async searchEmbeddingModels(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const credentials = await this.getCredentials('ociGenAiApi');
				if (!isOciGenAiCredentials(credentials)) {
					throw new NodeOperationError(this.getNode(), 'Invalid OCI Generative AI credentials');
				}

				const normalizedFilter = (filter ?? '').trim().toLowerCase();
				const regionId = credentials.regionId.trim().toLowerCase();
				const results = ON_DEMAND_EMBEDDING_MODELS.filter(
					(model) =>
						model.regions.includes(regionId) &&
						(!normalizedFilter ||
							model.displayName.toLowerCase().includes(normalizedFilter) ||
							model.modelId.includes(normalizedFilter)),
				).map(
					(model): INodeListSearchItems => ({
						name: model.displayName,
						value: model.modelId,
					}),
				);

				return {
					results:
						results.length > 0
							? results
							: [
									{
										name: 'No On-Demand Embedding Models Available in This Region',
										value: '',
									},
								],
				};
			},
		},
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials('ociGenAiApi');
		if (!isOciGenAiCredentials(credentials)) {
			throw new NodeOperationError(this.getNode(), 'Invalid OCI Generative AI credentials', {
				itemIndex,
			});
		}

		const compartmentId = (this.getNodeParameter('compartmentId', itemIndex, '') as string).trim();

		if (!compartmentId) {
			throw new NodeOperationError(this.getNode(), 'Compartment OCID is required.', { itemIndex });
		}

		const servingMode = this.getNodeParameter('servingMode', itemIndex, 'onDemand') as
			| 'onDemand'
			| 'dedicated';

		const dedicatedEndpointId = (
			this.getNodeParameter('dedicatedEndpointId', itemIndex, '') as string
		).trim();

		if (servingMode === 'dedicated' && !dedicatedEndpointId) {
			throw new NodeOperationError(
				this.getNode(),
				'Dedicated Endpoint ID is required when using Dedicated Endpoint serving mode.',
				{ itemIndex },
			);
		}

		const model =
			servingMode === 'onDemand'
				? getModelId(this.getNode(), this.getNodeParameter('model', itemIndex), itemIndex)
				: undefined;

		const options = this.getNodeParameter('options', itemIndex, {});

		const batchSize = (options.batchSize as number) ?? DEFAULT_BATCH_SIZE;
		const maxConcurrency = (options.maxConcurrency as number) ?? DEFAULT_MAX_CONCURRENCY;

		if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 96) {
			throw new NodeOperationError(
				this.getNode(),
				'Batch Size must be an integer between 1 and 96.',
				{ itemIndex },
			);
		}

		if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
			throw new NodeOperationError(
				this.getNode(),
				'Maximum Concurrency must be a positive integer.',
				{ itemIndex },
			);
		}

		const outputDimensions =
			typeof options.outputDimensions === 'number' && options.outputDimensions > 0
				? options.outputDimensions
				: undefined;

		const truncate = getTruncate(options.truncate);

		const client = await createOciGenAiClient(credentials);

		const embeddings = new OciGenAiEmbeddings({
			client,
			compartmentId,
			batchSize,
			maxConcurrency,
			...(outputDimensions !== undefined ? { outputDimensions } : {}),
			...(truncate !== undefined ? { truncate } : {}),
			...(servingMode === 'dedicated' ? { dedicatedEndpointId } : { onDemandModelId: model }),
		});

		return {
			response: logWrapper(embeddings, this),
		};
	}
}
