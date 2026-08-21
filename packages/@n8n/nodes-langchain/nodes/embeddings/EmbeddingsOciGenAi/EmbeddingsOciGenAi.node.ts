import { OciGenAiEmbeddings } from '@oracle/langchain-oci';
import { logWrapper } from '@n8n/ai-utilities';
import {
	NodeConnectionTypes,
	type ILoadOptionsFunctions,
	type INodeListSearchItems,
	type INodeListSearchResult,
	type INodeProperties,
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';

import {
	createOciGenAiModelClient,
	createOciGenAiClient,
	type OciGenAiCredentials,
} from '../../utils/ociGenAi';

const DEFAULT_MODEL = 'cohere.embed-v4.0';
const DEFAULT_BATCH_SIZE = 96;
const DEFAULT_MAX_CONCURRENCY = 2;

type ResourceLocatorValue = {
	mode: string;
	value: string;
};

function isResourceLocatorValue(value: unknown): value is ResourceLocatorValue {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	if (!('mode' in value) || !('value' in value)) {
		return false;
	}

	const candidate = value as {
		mode?: unknown;
		value?: unknown;
	};

	return typeof candidate.mode === 'string' && typeof candidate.value === 'string';
}

function getModelId(value: unknown): string {
	if (isResourceLocatorValue(value)) {
		const modelId = value.value.trim();

		if (!modelId) {
			throw new Error('Embedding model is required');
		}

		return modelId;
	}

	if (typeof value === 'string') {
		const modelId = value.trim();

		if (!modelId) {
			throw new Error('Embedding model is required');
		}

		return modelId;
	}

	throw new Error('Invalid embedding model value');
}

const modelProperty: INodeProperties = {
	displayName: 'Model',
	name: 'model',
	type: 'resourceLocator',
	default: {
		mode: 'list',
		value: DEFAULT_MODEL,
	},
	required: true,
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
	description:
		'The OCI Generative AI embedding model. Choose a model from the list or specify a model ID directly.',
};

const compartmentProperty: INodeProperties = {
	displayName: 'Compartment OCID',
	name: 'compartmentId',
	type: 'string',
	default: '',
	required: true,
	placeholder: 'ocid1.compartment.oc1..aaaa...',
	description: 'OCID of the compartment authorized to use OCI Generative AI.',
};

const servingModeProperty: INodeProperties = {
	displayName: 'Serving Mode',
	name: 'servingMode',
	type: 'options',
	options: [
		{
			name: 'On Demand',
			value: 'onDemand',
			description: 'Use an on-demand OCI Generative AI model.',
		},
		{
			name: 'Dedicated Endpoint',
			value: 'dedicated',
			description: 'Use a model deployed to an OCI Generative AI dedicated endpoint.',
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
	description: 'OCID of the dedicated AI endpoint hosting the embedding model.',
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
			description: 'Maximum number of texts included in one OCI embedding request.',
		},
		{
			displayName: 'Maximum Concurrency',
			name: 'maxConcurrency',
			type: 'number',
			default: DEFAULT_MAX_CONCURRENCY,
			typeOptions: {
				minValue: 1,
			},
			description: 'Maximum number of embedding requests that can run concurrently.',
		},
		{
			displayName: 'Output Dimensions',
			name: 'outputDimensions',
			type: 'number',
			default: 1024,
			typeOptions: {
				minValue: 1,
			},
			description: 'Optional output-vector dimension supported by compatible embedding models.',
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
			description: 'How OCI should handle input that exceeds the model token limit.',
		},
	],
};

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
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				const credentials = (await this.getCredentials('ociGenAiApi')) as OciGenAiCredentials;

				const compartmentId = this.getNodeParameter('compartmentId', '') as string;

				if (!compartmentId.trim()) {
					throw new Error('Enter a Compartment OCID before searching for embedding models.');
				}

				const client = await createOciGenAiModelClient(credentials);

				/*
				 * OCI's Generative AI control-plane API should be
				 * used for model discovery. We intentionally keep
				 * this filtering client-side so the search box can
				 * match both display name and model ID.
				 */
				const response = await client.listModels({
					compartmentId: compartmentId.trim(),
					limit: 100,
					...(paginationToken
						? {
								page: paginationToken,
							}
						: {}),
				});

				const normalizedFilter = (filter ?? '').trim().toLowerCase();

				const results = (response.items ?? [])
					.filter((model) => {
						/*
						 * The OCI model catalog capability enum
						 * has changed across SDK releases.
						 *
						 * For portability, filter embeddings
						 * using the model's capability metadata
						 * when present, otherwise fall back to
						 * the model ID/display name.
						 */
						const capabilities = model.capabilities ?? [];

						const isEmbeddingModel =
							capabilities.some((capability) =>
								String(capability).toLowerCase().includes('embed'),
							) ||
							model.id?.toLowerCase().includes('embed') ||
							model.displayName?.toLowerCase().includes('embed');

						if (!isEmbeddingModel) {
							return false;
						}

						if (!normalizedFilter) {
							return true;
						}

						return (
							model.id?.toLowerCase().includes(normalizedFilter) ||
							model.displayName?.toLowerCase().includes(normalizedFilter)
						);
					})
					.map(
						(model): INodeListSearchItems => ({
							name: model.displayName ?? model.id ?? 'OCI Embedding Model',
							value: model.id ?? '',
							url: model.id ? undefined : undefined,
						}),
					)
					.filter((model) => model.value !== '')
					.sort((a, b) => a.name.localeCompare(b.name));

				return {
					results,
					paginationToken: response.opcNextPage,
				};
			},
		},
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = (await this.getCredentials('ociGenAiApi')) as OciGenAiCredentials;

		const modelParameter = this.getNodeParameter('model', itemIndex);

		const model = getModelId(modelParameter);

		const compartmentId = this.getNodeParameter('compartmentId', itemIndex) as string;

		if (!compartmentId.trim()) {
			throw new Error('Compartment OCID is required.');
		}

		const servingMode = this.getNodeParameter('servingMode', itemIndex, 'onDemand') as
			| 'onDemand'
			| 'dedicated';

		const dedicatedEndpointId = this.getNodeParameter(
			'dedicatedEndpointId',
			itemIndex,
			'',
		) as string;

		if (servingMode === 'dedicated' && !dedicatedEndpointId.trim()) {
			throw new Error(
				'Dedicated Endpoint ID is required when using Dedicated Endpoint serving mode.',
			);
		}

		const options = this.getNodeParameter('options', itemIndex, {}) as {
			batchSize?: number;
			maxConcurrency?: number;
			outputDimensions?: number;
			truncate?: string;
		};

		const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

		const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

		if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 96) {
			throw new Error('Batch Size must be an integer between 1 and 96.');
		}

		if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
			throw new Error('Maximum Concurrency must be a positive integer.');
		}

		const outputDimensions =
			typeof options.outputDimensions === 'number' && options.outputDimensions > 0
				? options.outputDimensions
				: undefined;

		const truncate = typeof options.truncate === 'string' ? options.truncate : undefined;

		/*
		 * createOciGenAiClient() returns the authenticated
		 * GenerativeAiInferenceClient used by @oracle/langchain-oci.
		 */
		const client = await createOciGenAiClient(credentials);

		const embeddings = new OciGenAiEmbeddings({
			client,

			compartmentId: compartmentId.trim(),

			batchSize,

			maxConcurrency,

			...(outputDimensions !== undefined
				? {
						outputDimensions,
					}
				: {}),

			...(truncate
				? {
						truncate: truncate as 'NONE' | 'START' | 'END',
					}
				: {}),

			...(servingMode === 'dedicated'
				? {
						dedicatedEndpointId: dedicatedEndpointId.trim(),
					}
				: {
						onDemandModelId: model,
					}),
		});

		return {
			response: logWrapper(embeddings, this),
		};
	}
}
