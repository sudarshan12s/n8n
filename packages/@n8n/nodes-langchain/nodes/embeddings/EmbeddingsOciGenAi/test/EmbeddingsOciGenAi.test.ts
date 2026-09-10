import { logWrapper } from '@n8n/ai-utilities';
import { OciGenAiEmbeddings } from '@oracle/langchain-oci';
import { createMockExecuteFunction } from 'n8n-nodes-base/test/nodes/Helpers';
import type { INode, INodeProperties, ISupplyDataFunctions } from 'n8n-workflow';
import type { Mocked } from 'vitest';

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock('@n8n/ai-utilities', () => ({
	getConnectionHintNoticeField: vi.fn(() => ({
		displayName: 'Connection hint',
		name: 'connectionHint',
		type: 'notice',
		default: '',
	})),
	logWrapper: vi.fn((instance: unknown) => instance),
}));

vi.mock('@oracle/langchain-oci', () => ({
	OciGenAiEmbeddings: vi.fn().mockImplementation(function MockOciGenAiEmbeddings() {}),
}));

vi.mock('../../../../utils/ociGenAi', () => ({
	createOciGenAiClient: createClient,
	getOnDemandEmbeddingModels: () => [],
	isOciGenAiCredentials: () => true,
	validateOciCompartmentId: (value: string) => {
		if (!value.startsWith('ocid1.compartment.')) throw new Error('Invalid OCI Compartment OCID');
		return value;
	},
	validateOciModelId: (value: string) => value,
}));

import { EmbeddingsOciGenAi } from '../EmbeddingsOciGenAi.node';

const MockedOciGenAiEmbeddings = vi.mocked(OciGenAiEmbeddings);
const mockedLogWrapper = vi.mocked(logWrapper);

describe('EmbeddingsOciGenAi', () => {
	const mockNode: INode = {
		id: '1',
		name: 'Embeddings OCI Generative AI',
		type: '@n8n/n8n-nodes-langchain.embeddingsOciGenAi',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	};

	const createContext = (): Mocked<ISupplyDataFunctions> => {
		const context = createMockExecuteFunction<ISupplyDataFunctions>(
			{},
			mockNode,
		) as Mocked<ISupplyDataFunctions>;
		context.getCredentials = vi.fn().mockResolvedValue({
			authentication: 'apiKey',
			regionId: 'us-chicago-1',
		});
		context.getNode = vi.fn().mockReturnValue(mockNode);
		context.getNodeParameter = vi.fn().mockImplementation((name: string) => {
			if (name === 'model') return 'cohere.embed-v4.0';
			if (name === 'compartmentId') return 'ocid1.compartment.oc1..test';
			if (name === 'servingMode') return 'onDemand';
			if (name === 'options') {
				return { batchSize: 24, maxConcurrency: 3, outputDimensions: 1024, truncate: 'END' };
			}
			return '';
		});
		return context;
	};

	beforeEach(() => {
		vi.clearAllMocks();
		createClient.mockResolvedValue({ client: 'inference' });
	});

	it('does not run a credential test when the credential editor opens', () => {
		const node = new EmbeddingsOciGenAi();

		expect(node.description.credentials).toEqual([{ name: 'ociGenAiApi', required: true }]);
		expect(node.methods).not.toHaveProperty('credentialTest');
	});

	it('explains how each truncation option handles oversized input', () => {
		const node = new EmbeddingsOciGenAi();
		const options = node.description.properties.find((property) => property.name === 'options');
		const truncate = options?.options?.find((property) => property.name === 'truncate');

		expect(truncate).toMatchObject({
			default: 'NONE',
			description:
				'Controls how OCI handles input that exceeds the model token limit. None returns an error. Start removes tokens from the beginning. End removes tokens from the end.',
		});
	});

	it('explains output dimension compatibility with the selected model and vector store', () => {
		const node = new EmbeddingsOciGenAi();
		const options = node.description.properties.find((property) => property.name === 'options');
		const outputDimensions = options?.options?.find(
			(property) => property.name === 'outputDimensions',
		) as INodeProperties | undefined;

		expect(outputDimensions).toMatchObject({
			default: 1536,
			description:
				'Number of dimensions in the returned embedding vector. Cohere Embed 4 supports 256, 512, 1024, and 1536. Changing this value can require a vector store with matching dimensions.',
		});
		expect(outputDimensions?.options).toEqual([
			{ name: '256', value: 256 },
			{ name: '512', value: 512 },
			{ name: '1024', value: 1024 },
			{ name: '1536', value: 1536 },
		]);
		expect(outputDimensions?.displayOptions).toEqual({
			show: { '/model.value': ['cohere.embed-v4.0'] },
		});
	});

	it('explains the maximum concurrency throughput tradeoff', () => {
		const node = new EmbeddingsOciGenAi();
		const options = node.description.properties.find((property) => property.name === 'options');
		const maxConcurrency = options?.options?.find((property) => property.name === 'maxConcurrency');

		expect(maxConcurrency).toMatchObject({
			description:
				'Maximum number of OCI embedding requests to run concurrently. Higher values can improve bulk ingestion throughput but can increase throttling.',
		});
	});

	it('creates OCI embeddings with the selected model and options', async () => {
		const node = new EmbeddingsOciGenAi();
		const context = createContext();

		const result = await node.supplyData.call(context, 0);

		expect(MockedOciGenAiEmbeddings).toHaveBeenCalledWith(
			expect.objectContaining({
				client: { client: 'inference' },
				compartmentId: 'ocid1.compartment.oc1..test',
				onDemandModelId: 'cohere.embed-v4.0',
				batchSize: 24,
				maxConcurrency: 3,
				outputDimensions: 1024,
				truncate: 'END',
			}),
		);
		expect(mockedLogWrapper).toHaveBeenCalledWith(expect.any(MockedOciGenAiEmbeddings), context);
		expect(result).toHaveProperty('response');
	});

	it('requires an endpoint ID for dedicated embeddings', async () => {
		const node = new EmbeddingsOciGenAi();
		const context = createContext();
		context.getNodeParameter = vi.fn().mockImplementation((name: string) => {
			if (name === 'compartmentId') return 'ocid1.compartment.oc1..test';
			if (name === 'servingMode') return 'dedicated';
			if (name === 'options') return {};
			return '';
		});

		await expect(node.supplyData.call(context, 0)).rejects.toThrow(
			'Dedicated Endpoint ID is required',
		);
		expect(createClient).not.toHaveBeenCalled();
	});

	it('rejects output dimensions for an on-demand model that does not support them', async () => {
		const node = new EmbeddingsOciGenAi();
		const context = createContext();
		context.getNodeParameter = vi.fn().mockImplementation((name: string) => {
			if (name === 'model') return 'cohere.embed-english-v3.0';
			if (name === 'compartmentId') return 'ocid1.compartment.oc1..test';
			if (name === 'servingMode') return 'onDemand';
			if (name === 'options') return { outputDimensions: 1024 };
			return '';
		});

		await expect(node.supplyData.call(context, 0)).rejects.toThrow(
			'Output Dimensions is supported only by Cohere Embed 4',
		);
		expect(createClient).not.toHaveBeenCalled();
	});

	it('rejects unsupported output dimensions for Cohere Embed 4', async () => {
		const node = new EmbeddingsOciGenAi();
		const context = createContext();
		context.getNodeParameter = vi.fn().mockImplementation((name: string) => {
			if (name === 'model') return 'cohere.embed-v4.0';
			if (name === 'compartmentId') return 'ocid1.compartment.oc1..test';
			if (name === 'servingMode') return 'onDemand';
			if (name === 'options') return { outputDimensions: 768 };
			return '';
		});

		await expect(node.supplyData.call(context, 0)).rejects.toThrow(
			'Output Dimensions for Cohere Embed 4 must be 256, 512, 1024, or 1536.',
		);
		expect(createClient).not.toHaveBeenCalled();
	});
});
