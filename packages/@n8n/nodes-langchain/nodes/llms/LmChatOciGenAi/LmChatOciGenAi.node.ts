import { OciGenAiGenericChat } from '@oracle/langchain-oci';
import { logWrapper } from '@n8n/ai-utilities';
import {
	NodeConnectionTypes,
	type IDataObject,
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';

import { createOciGenAiClient, type OciGenAiCredentials } from '../../utils/ociGenAi';

const DEFAULT_MODEL = 'meta.llama-3.3-70b-instruct';

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
			{
				displayName: 'Model',
				name: 'model',
				type: 'string',
				default: DEFAULT_MODEL,
				required: true,
				placeholder: 'meta.llama-3.3-70b-instruct',
				description: 'OCI Generative AI model ID',
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
						displayName: 'Temperature',
						name: 'temperature',
						type: 'number',
						default: 0.7,
						typeOptions: {
							minValue: 0,
							maxValue: 2,
							numberPrecision: 2,
						},
					},
					{
						displayName: 'Maximum Tokens',
						name: 'maxTokens',
						type: 'number',
						default: 1024,
						typeOptions: {
							minValue: 1,
						},
					},
					{
						displayName: 'Top P',
						name: 'topP',
						type: 'number',
						default: 0.9,
						typeOptions: {
							minValue: 0,
							maxValue: 1,
							numberPrecision: 2,
						},
					},
					{
						displayName: 'Top K',
						name: 'topK',
						type: 'number',
						default: 0,
						typeOptions: {
							minValue: 0,
						},
					},
					{
						displayName: 'Seed',
						name: 'seed',
						type: 'number',
						default: 0,
						typeOptions: {
							minValue: 0,
						},
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

		const modelInstance = new OciGenAiGenericChat({
			client,

			compartmentId: compartmentId.trim(),

			...(servingMode === 'dedicated'
				? {
						dedicatedEndpointId: dedicatedEndpointId.trim(),
					}
				: {
						onDemandModelId: model.trim(),
					}),
		});

		/*
		 * Provider-specific generation parameters belong in
		 * requestParams. OciGenAiGenericChat maps these into
		 * OCI's GenericChatRequest.
		 */
		const boundModel = modelInstance.bind({
			requestParams: {
				...(typeof options.temperature === 'number'
					? {
							temperature: options.temperature,
						}
					: {}),

				...(typeof options.maxTokens === 'number'
					? {
							maxTokens: options.maxTokens,
						}
					: {}),

				...(typeof options.topP === 'number'
					? {
							topP: options.topP,
						}
					: {}),

				...(typeof options.topK === 'number' && options.topK > 0
					? {
							topK: options.topK,
						}
					: {}),

				...(typeof options.seed === 'number'
					? {
							seed: options.seed,
						}
					: {}),
			},
		});

		return {
			response: logWrapper(boundModel, this),
		};
	}
}
