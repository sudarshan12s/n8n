import { OciGenAiGenericChat } from '@oracle/langchain-oci';
import { logWrapper } from '@n8n/ai-utilities';
import {
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
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
	createOciGenAiClient,
	createOciGenAiModelClient,
	type OciGenAiCredentials,
} from '../../utils/ociGenAi';

const DEFAULT_MODEL = 'meta.llama-3.3-70b-instruct';
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TOP_P = 0.9;

type ResourceLocatorValue = {
	mode: string;
	value: string;
};

type OciChatRequestParams = {
	temperature?: number;
	maxTokens?: number;
	topP?: number;
	topK?: number;
	seed?: number;
};

function isResourceLocatorValue(value: unknown): value is ResourceLocatorValue {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return typeof candidate.mode === 'string' && typeof candidate.value === 'string';
}

function getModelId(value: unknown): string {
	if (isResourceLocatorValue(value)) {
		const modelId = value.value.trim();
		if (!modelId) throw new Error('Chat model is required');
		return modelId;
	}
	if (typeof value === 'string') {
		const modelId = value.trim();
		if (!modelId) throw new Error('Chat model is required');
		return modelId;
	}
	throw new Error('Invalid chat model value');
}

class N8nOciGenAiGenericChat extends OciGenAiGenericChat {
	private readonly defaultRequestParams: OciChatRequestParams;

	constructor(
		params: ConstructorParameters<typeof OciGenAiGenericChat>[0] & {
			defaultRequestParams?: OciChatRequestParams;
		},
	) {
		super(params);
		this.defaultRequestParams = params.defaultRequestParams ?? {};
	}

	override _createRequest(
		messages: Parameters<OciGenAiGenericChat['_createRequest']>[0],
		options: Parameters<OciGenAiGenericChat['_createRequest']>[1],
		stream?: boolean,
	) {
		const requestParams = {
			...this.defaultRequestParams,
			...(options.requestParams ?? {}),
		};

		return super._createRequest(messages, { ...options, requestParams }, stream);
	}
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
			placeholder: 'Select a chat model...',
			typeOptions: {
				searchListMethod: 'searchChatModels',
				searchable: true,
			},
		},
		{
			displayName: 'ID',
			name: 'id',
			type: 'string',
			placeholder: 'meta.llama-3.3-70b-instruct',
		},
	],
	description:
		'Select an OCI Generative AI chat model from the compartment or enter the model ID directly.',
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

const vendorProperty: INodeProperties = {
	displayName: 'Vendor',
	name: 'vendor',
	type: 'string',
	default: '',
	placeholder: 'Meta, Cohere, Google, etc.',
	description: 'Optional vendor filter used when searching the model list.',
};

const servingModeProperty: INodeProperties = {
	displayName: 'Serving Mode',
	name: 'servingMode',
	type: 'options',
	options: [
		{
			name: 'On Demand',
			value: 'onDemand',
			description: 'Use an OCI Generative AI on-demand model.',
		},
		{
			name: 'Dedicated Endpoint',
			value: 'dedicated',
			description: 'Use a model deployed to a dedicated OCI AI endpoint.',
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
	description: 'OCID of the dedicated OCI Generative AI endpoint hosting the model.',
};

const optionsProperty: INodeProperties = {
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add Option',
	default: {},
	options: [
		{
			displayName: 'Temperature',
			name: 'temperature',
			type: 'number',
			default: DEFAULT_TEMPERATURE,
			typeOptions: {
				minValue: 0,
				maxValue: 2,
				numberPrecision: 2,
			},
			description: 'Controls the randomness of generated responses.',
		},
		{
			displayName: 'Maximum Tokens',
			name: 'maxTokens',
			type: 'number',
			default: DEFAULT_MAX_TOKENS,
			typeOptions: {
				minValue: 1,
			},
			description: 'Maximum number of tokens generated in the response.',
		},
		{
			displayName: 'Top P',
			name: 'topP',
			type: 'number',
			default: DEFAULT_TOP_P,
			typeOptions: {
				minValue: 0,
				maxValue: 1,
				numberPrecision: 2,
			},
			description: 'Controls nucleus sampling.',
		},
		{
			displayName: 'Top K',
			name: 'topK',
			type: 'number',
			default: 0,
			typeOptions: {
				minValue: 0,
			},
			description:
				'Number of highest-probability tokens considered for generation. Set to 0 to leave unset.',
		},
		{
			displayName: 'Seed',
			name: 'seed',
			type: 'number',
			default: 0,
			typeOptions: {
				minValue: 0,
			},
			description:
				'Optional seed for deterministic generation where supported by the selected model.',
		},
	],
};

export class LmChatOciGenAi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'OCI Generative AI Chat Model',
		name: 'lmChatOciGenAi',
		icon: 'file:ociGenAi.svg',
		group: ['transform'],
		version: 1,
		description: 'Use OCI Generative AI chat models with n8n AI chains and agents',
		defaults: {
			name: 'OCI Generative AI Chat Model',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Language Models', 'Root Nodes'],
				'Language Models': ['Chat Models (Recommended)'],
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
		outputs: [NodeConnectionTypes.AiLanguageModel],
		outputNames: ['Model'],
		properties: [
			modelProperty,
			compartmentProperty,
			vendorProperty,
			servingModeProperty,
			dedicatedEndpointProperty,
			optionsProperty,
		],
	};

	methods = {
		listSearch: {
			async searchChatModels(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				const compartmentId = (this.getNodeParameter('compartmentId', '') as string).trim();

				if (!compartmentId) {
					return {
						results: [
							{
								name: 'Enter a Compartment OCID to load models',
								value: '',
							},
						],
					};
				}

				const credentials = (await this.getCredentials('ociGenAiApi')) as OciGenAiCredentials;
				const client = await createOciGenAiModelClient(credentials);
				const vendor = (this.getNodeParameter('vendor', '') as string).trim();

				const response = await client.listModels({
					compartmentId,
					capability: ['CHAT'],
					...(vendor ? { vendor } : {}),
					limit: 100,
					...(paginationToken ? { page: paginationToken } : {}),
				});

				const normalizedFilter = (filter ?? '').trim().toLowerCase();

				const results: INodeListSearchItems[] = (response.items ?? [])
					.filter((model) => {
						if (!normalizedFilter) return true;
						const name = model.displayName ?? '';
						const id = model.id ?? '';
						return (
							name.toLowerCase().includes(normalizedFilter) ||
							id.toLowerCase().includes(normalizedFilter)
						);
					})
					.map((model) => ({
						name: model.displayName ?? model.id ?? 'OCI Chat Model',
						value: model.id ?? '',
					}))
					.filter((model) => model.value.length > 0)
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

		let model: string;
		try {
			const modelParameter = this.getNodeParameter('model', itemIndex);
			model = getModelId(modelParameter);
		} catch (error) {
			throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
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

		const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

		const temperature =
			typeof options.temperature === 'number' ? options.temperature : DEFAULT_TEMPERATURE;

		const maxTokens =
			typeof options.maxTokens === 'number' ? options.maxTokens : DEFAULT_MAX_TOKENS;

		const topP = typeof options.topP === 'number' ? options.topP : DEFAULT_TOP_P;

		const topK = typeof options.topK === 'number' && options.topK > 0 ? options.topK : undefined;

		const seed = typeof options.seed === 'number' && options.seed >= 0 ? options.seed : undefined;

		const client = await createOciGenAiClient(credentials);

		const defaultRequestParams: OciChatRequestParams = {
			temperature,
			maxTokens,
			topP,
			...(topK !== undefined ? { topK } : {}),
			...(seed !== undefined ? { seed } : {}),
		};

		const modelParams = {
			client,
			compartmentId,
			defaultRequestParams,
			...(servingMode === 'onDemand' ? { onDemandModelId: model } : { dedicatedEndpointId }),
		};

		const chatModel = new N8nOciGenAiGenericChat(modelParams);

		return {
			response: logWrapper(chatModel, this),
		};
	}
}
