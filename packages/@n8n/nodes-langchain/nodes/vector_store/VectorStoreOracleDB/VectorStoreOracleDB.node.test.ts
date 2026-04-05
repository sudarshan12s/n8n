/* eslint-disable n8n-nodes-base/node-filename-against-convention */
import type { Embeddings } from '@langchain/core/embeddings';
import type { IExecuteFunctions } from 'n8n-workflow';

import type { Pool } from 'oracledb';

const poolCloseMocks: jest.Mock[] = [];
const createdPools: Pool[] = [];
const createPoolMock = jest.fn();
const initOracleClientMock = jest.fn();

jest.mock('oracledb', () => ({
	__esModule: true,
	default: {
		createPool: createPoolMock,
		initOracleClient: initOracleClientMock,
	},
	createPool: createPoolMock,
	initOracleClient: initOracleClientMock,
}));

const initializeSpy = jest.fn();
const fromDocumentsSpy = jest.fn();
const addDocumentsSpy = jest.fn();
const similaritySearchSpy = jest.fn();

const DistanceStrategyMock = {
	COSINE: 'COSINE',
	DOT_PRODUCT: 'DOT',
	EUCLIDEAN: 'EUCLIDEAN',
	MANHATTAN: 'MANHATTAN',
	EUCLIDEAN_SQUARED: 'EUCLIDEAN_SQUARED',
	HAMMING: 'HAMMING',
};

class OracleVSStub {
	static instances: OracleVSStub[] = [];
	filter?: Record<string, never>;
	client: unknown;

	constructor(
		public readonly embeddings: Embeddings,
		public readonly args: any,
	) {
		this.filter = args.filter;
		this.client = args.client;
		OracleVSStub.instances.push(this);
	}

	async initialize(): Promise<void> {
		initializeSpy(this.embeddings, this.args);
	}

	addDocuments = jest.fn(async (documents: unknown[], options?: unknown) => {
		addDocumentsSpy(documents, options);
	});

	similaritySearchVectorWithScore(query: number[], k: number, filter?: Record<string, never>) {
		similaritySearchSpy(query, k, filter);
		return Promise.resolve([]);
	}

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
	const baseCredentials = {
		connectionString: 'oracle://localhost:1521/XEPDB1',
		user: 'user',
		password: 'pw',
		useThickMode: false,
		useSSL: false,
		poolMin: 0,
		poolMax: 4,
		poolIncrement: 1,
		poolTimeout: 60,
		maxLifetimeSession: 60,
		privilege: undefined,
	};

	const defaultGetNodeParameter = (name: string) => {
		if (name === 'tableName') return 'n8n_vectors';
		if (name === 'options.distanceStrategy') return DistanceStrategyMock.DOT_PRODUCT;
		return undefined;
	};

	beforeEach(() => {
		jest.clearAllMocks();
		createdPools.length = 0;
		poolCloseMocks.length = 0;
		createPoolMock.mockImplementation(async () => {
			const pool: Partial<Pool> & { close: jest.Mock } = {
				close: jest.fn().mockResolvedValue(undefined),
				connectionsOpen: 0,
			};
			createdPools.push(pool as Pool);
			poolCloseMocks.push(pool.close);
			return pool as Pool;
		});
		context.getCredentials.mockImplementation(async () => ({ ...baseCredentials }));
		context.getNodeParameter.mockImplementation(defaultGetNodeParameter);
		OracleVSStub.instances = [];
		similaritySearchSpy.mockReset();
		initOracleClientMock.mockClear();
	});

	it('passes configuration to ExtendedOracleDBVectorStore.initialize', async () => {
		const node = new VectorStoreOracleDB();
		const filter = { project: 'n8n' } as unknown as Record<string, never>;

		const vectorStore = await node.getVectorStoreClient(context, filter, embeddings, 0);

		expect(createPoolMock).toHaveBeenCalledTimes(1);
		const poolConfig = createPoolMock.mock.calls[0][0];
		expect(poolConfig).toMatchObject({
			user: 'user',
			password: 'pw',
			connectionString: baseCredentials.connectionString,
		});
		expect(poolConfig).not.toHaveProperty('useThickMode');
		expect(initializeSpy).toHaveBeenCalledTimes(1);
		const initArgs = initializeSpy.mock.calls[0][1];
		expect(initArgs).toMatchObject({
			client: createdPools[0],
			tableName: 'n8n_vectors',
			query: '',
			filter,
			distanceStrategy: DistanceStrategyMock.DOT_PRODUCT,
		});
		expect(vectorStore).toBeInstanceOf(OracleVSStub);
	});

	it('passes array metadata filters without $in operator', async () => {
		const node = new VectorStoreOracleDB();
		const filter = {
			author: ['Andrew Ng', 'Demis Hassabis'],
		} as unknown as Record<string, never>;

		await node.getVectorStoreClient(context, filter, embeddings, 0);

		const initArgs = initializeSpy.mock.calls.at(-1)?.[1];
		expect(initArgs?.filter).toEqual(filter);
	});

	it('passes metadata filters using $nin operator', async () => {
		const node = new VectorStoreOracleDB();
		const filter = {
			author: { $nin: ['Andrew Ng', 'Demis Hassabis'] },
		} as unknown as Record<string, never>;

		await node.getVectorStoreClient(context, filter, embeddings, 0);

		const initArgs = initializeSpy.mock.calls.at(-1)?.[1];
		expect(initArgs?.filter).toEqual(filter);
	});

	it('populates vector store using OracleVS.fromDocuments with proper config', async () => {
		const node = new VectorStoreOracleDB();

		await node.populateVectorStore(context, embeddings, documents, 0);

		expect(createPoolMock).toHaveBeenCalledTimes(1);
		expect(fromDocumentsSpy).toHaveBeenCalledWith(
			documents,
			embeddings,
			expect.objectContaining({
				client: createdPools[0],
				tableName: 'n8n_vectors',
				query: 'Test',
			}),
		);
		expect(poolCloseMocks[0]).toHaveBeenCalled();
	});

	it('adds documents with mutateOnDuplicate when updating by ID', async () => {
		const node = new VectorStoreOracleDB();
		const updateDocument = [{ pageContent: 'content', metadata: {} }] as any;

		context.getNodeParameter.mockImplementation((name: string) => {
			if (name === 'mode') return 'update';
			return defaultGetNodeParameter(name);
		});

		const vectorStore = await capturedConfig.getVectorStoreClient(
			context,
			undefined,
			embeddings,
			0,
		);
		await vectorStore.addDocuments(updateDocument, { ids: ['doc-id'] });

		capturedConfig.releaseVectorStoreClient?.(vectorStore);

		expect(createPoolMock).toHaveBeenCalledTimes(1);
		expect(addDocumentsSpy).toHaveBeenCalledWith(updateDocument, {
			ids: ['doc-id'],
			mutateOnDuplicate: true,
		});
		expect(poolCloseMocks[0]).toHaveBeenCalled();
	});

	it('merges stored filter with ad-hoc filter for similarity search', async () => {
		const node = new VectorStoreOracleDB();
		const baseFilter = { project: 'n8n' } as unknown as Record<string, never>;
		const vectorStore = await node.getVectorStoreClient(context, baseFilter, embeddings, 0);

		const runtimeFilter = { author: 'Andrew Ng' } as unknown as Record<string, never>;
		await vectorStore.similaritySearchVectorWithScore([0.1, 0.2], 3, runtimeFilter);

		expect(similaritySearchSpy).toHaveBeenCalledWith([0.1, 0.2], 3, {
			...baseFilter,
			...runtimeFilter,
		});
	});

	it('closes connection pool through releaseVectorStoreClient', async () => {
		const node = new VectorStoreOracleDB();
		await node.getVectorStoreClient(context, undefined, embeddings, 0);

		expect(poolCloseMocks[0]).not.toHaveBeenCalled();
		capturedConfig.releaseVectorStoreClient?.(OracleVSStub.instances.at(-1)!);
		expect(poolCloseMocks[0]).toHaveBeenCalled();
	});
});
