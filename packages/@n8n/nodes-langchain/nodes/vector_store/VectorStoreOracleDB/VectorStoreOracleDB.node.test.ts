/* eslint-disable n8n-nodes-base/node-filename-against-convention */
import type { Embeddings } from '@langchain/core/embeddings';
import type { IExecuteFunctions } from 'n8n-workflow';

const configureOracleDBMock = jest.fn();
jest.mock('n8n-nodes-base/dist/nodes/Oracle/Sql/transport', () => ({
	configureOracleDB: configureOracleDBMock,
}));

const initializeSpy = jest.fn();
const fromDocumentsSpy = jest.fn();

const DistanceStrategyMock = {
	COSINE: 'COSINE',
	DOT_PRODUCT: 'DOT',
	EUCLIDEAN: 'EUCLIDEAN',
	MANHATTAN: 'MANHATTAN',
	EUCLIDEAN_SQUARED: 'EUCLIDEAN_SQUARED',
};

class OracleVSStub {
	static instances: OracleVSStub[] = [];
	filter?: Record<string, never>;

	constructor(
		public readonly embeddings: Embeddings,
		public readonly args: any,
	) {
		this.filter = args.filter;
		OracleVSStub.instances.push(this);
	}

	async initialize(): Promise<void> {
		initializeSpy(this.embeddings, this.args);
	}

	similaritySearchVectorWithScore = jest.fn();

	static async fromDocuments(documents: unknown[], embeddings: Embeddings, config: any) {
		fromDocumentsSpy(documents, embeddings, config);
	}
}

jest.mock('@oracle/langchain-oracledb', () => ({
	DistanceStrategy: DistanceStrategyMock,
	OracleVS: OracleVSStub,
}));

let capturedConfig: any;
jest.mock('@n8n/ai-utilities', () => {
	const actual = jest.requireActual('@n8n/ai-utilities');
	return {
		...actual,
		metadataFilterField: {},
		createVectorStoreNode: (config: any) => {
			capturedConfig = config;
			return class TestVectorStoreNode {
				async getVectorStoreClient(...args: any[]) {
					return config.getVectorStoreClient(...args);
				}
				async populateVectorStore(...args: any[]) {
					return config.populateVectorStore(...args);
				}
			};
		},
	};
});

import { VectorStoreOracleDB } from './VectorStoreOracleDB.node';

describe('VectorStoreOracleDB.node', () => {
	const pool = {
		getConnection: jest.fn(),
	};

	const context = {
		getNodeParameter: jest.fn(),
		getCredentials: jest.fn(),
		logger: {
			debug: jest.fn(),
			error: jest.fn(),
			info: jest.fn(),
			warn: jest.fn(),
		},
	} as unknown as jest.Mocked<IExecuteFunctions>;

	const embeddings = {} as Embeddings;
	const documents = [{ id: 1 }, { id: 2 }] as any;

	beforeEach(() => {
		jest.clearAllMocks();
		configureOracleDBMock.mockResolvedValue(pool);
		context.getCredentials.mockResolvedValue({ user: 'user', password: 'pw' });
		context.getNodeParameter.mockImplementation((name: string) => {
			if (name === 'tableName') return 'n8n_vectors';
			if (name === 'options.distanceStrategy') return DistanceStrategyMock.DOT_PRODUCT;
			return undefined;
		});
	});

	it('passes configuration to ExtendedOracleDBVectorStore.initialize', async () => {
		const node = new VectorStoreOracleDB();
		const filter = { project: 'n8n' } as Record<string, never>;

		const vectorStore = await node.getVectorStoreClient(context, filter, embeddings, 0);

		expect(configureOracleDBMock).toHaveBeenCalledWith({ user: 'user', password: 'pw' });
		expect(initializeSpy).toHaveBeenCalledTimes(1);
		const initArgs = initializeSpy.mock.calls[0][1];
		expect(initArgs).toMatchObject({
			client: pool,
			tableName: 'n8n_vectors',
			query: '',
			filter,
			distanceStrategy: DistanceStrategyMock.DOT_PRODUCT,
		});
		expect(vectorStore).toBeInstanceOf(OracleVSStub);
	});

	it('populates vector store using OracleVS.fromDocuments with proper config', async () => {
		const node = new VectorStoreOracleDB();

		await node.populateVectorStore(context, embeddings, documents, 0);

		expect(configureOracleDBMock).toHaveBeenCalled();
		expect(fromDocumentsSpy).toHaveBeenCalledWith(
			documents,
			embeddings,
			expect.objectContaining({
				client: pool,
				tableName: 'n8n_vectors',
				query: 'Test',
			}),
		);
	});
});
