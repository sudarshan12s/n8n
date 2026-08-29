import { logWrapper } from '@n8n/ai-utilities';
import { OciGenAiEmbeddings } from '@oracle/langchain-oci';
import { createMockExecuteFunction } from 'n8n-nodes-base/test/nodes/Helpers';
import type { INode, ISupplyDataFunctions } from 'n8n-workflow';
import type { Mocked } from 'vitest';

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock('@n8n/ai-utilities', () => ({
	logWrapper: vi.fn((instance: unknown) => instance),
}));

vi.mock('@oracle/langchain-oci', () => ({
	OciGenAiEmbeddings: vi.fn().mockImplementation(function MockOciGenAiEmbeddings() {}),
}));

vi.mock('../../../../utils/ociGenAi', () => ({
	createOciGenAiClient: createClient,
	getOnDemandEmbeddingModels: () => [],
	isOciGenAiCredentials: () => true,
	testOciGenAiConnection: vi.fn(),
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
});
