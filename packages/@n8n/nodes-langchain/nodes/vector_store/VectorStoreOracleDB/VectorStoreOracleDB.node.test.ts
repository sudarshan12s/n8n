import type { Document } from '@langchain/core/documents';
import type { Embeddings } from '@langchain/core/embeddings';
import { VectorStore } from '@langchain/core/vectorstores';
import type { VectorStoreNodeConstructorArgs } from '@n8n/ai-utilities';
import { ConnectionPoolManager } from 'n8n-nodes-base/dist/utils/connection-pool-manager';
import type { IExecuteFunctions } from 'n8n-workflow';
import type { Pool } from 'oracledb';

const poolCloseMocks: Array<jest.Mock<Promise<void>, []>> = [];
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

type OracleVSStubArgs = {
	filter?: Record<string, never>;
	client?: unknown;
	[key: string]: unknown;
};

type VectorSearchResult = Array<[Document<Record<string, unknown>>, number]>;

type InitializeFn = (embeddings: Embeddings, args: OracleVSStubArgs) => void;
const initializeSpy: jest.MockedFunction<InitializeFn> = jest.fn((embeddings, args) => {
	void embeddings;
	void args;
});

type FromDocumentsFn = (
	documents: Array<Document<Record<string, unknown>>>,
	embeddings: Embeddings,
	config: Record<string, unknown>,
) => Promise<void>;
const fromDocumentsSpy: jest.MockedFunction<FromDocumentsFn> = jest.fn(
	async (documents, embeddings, config) => {
		void documents;
		void embeddings;
		void config;
	},
);

type AddDocumentsFn = (
	documents: Array<Document<Record<string, unknown>>>,
	options?: unknown,
) => Promise<void>;
const addDocumentsSpy: jest.MockedFunction<AddDocumentsFn> = jest.fn(async (documents, options) => {
	void documents;
	void options;
});

type SimilaritySearchFn = (
	query: number[],
	k: number,
	filter?: Record<string, never>,
) => Promise<VectorSearchResult>;
const similaritySearchSpy: jest.MockedFunction<SimilaritySearchFn> = jest.fn(
	async (query, k, filter) => {
		void query;
		void k;
		void filter;
		return [];
	},
);

const DistanceStrategyMock = {
	COSINE: 'COSINE',
	DOT_PRODUCT: 'DOT',
	EUCLIDEAN: 'EUCLIDEAN',
	MANHATTAN: 'MANHATTAN',
	EUCLIDEAN_SQUARED: 'EUCLIDEAN_SQUARED',
	HAMMING: 'HAMMING',
} as const;

class OracleVSStub extends VectorStore {
	static instances: OracleVSStub[] = [];

	filter?: Record<string, never>;

	client: unknown;

	private readonly embeddings: Embeddings;

	private readonly args: OracleVSStubArgs;

	constructor(embeddings: Embeddings, args: OracleVSStubArgs) {
		super(embeddings, args);
		this.embeddings = embeddings;
		this.args = args;
		this.filter = args.filter;
		this.client = args.client;
		OracleVSStub.instances.push(this);
	}

	async initialize(): Promise<void> {
		initializeSpy(this.embeddings, this.args);
		await Promise.resolve();
	}

	_vectorstoreType(): string {
		return 'oracle-stub';
	}

	async addVectors(
		vectors: number[][],
		documents: Array<Document<Record<string, unknown>>>,
		options?: Record<string, unknown>,
	): Promise<void> {
		void vectors;
		void documents;
		void options;
		await Promise.resolve();
	}

	async addDocuments(
		documents: Array<Document<Record<string, unknown>>>,
		options?: unknown,
	): Promise<void> {
		await addDocumentsSpy(documents, options);
	}

	async similaritySearchVectorWithScore(
		query: number[],
		k: number,
		filter?: Record<string, never>,
	): Promise<VectorSearchResult> {
		return await similaritySearchSpy(query, k, filter);
	}

	static async fromDocuments(
		documents: Array<Document<Record<string, unknown>>>,
		embeddings: Embeddings,
		config: Record<string, unknown>,
	): Promise<OracleVSStub> {
		await fromDocumentsSpy(documents, embeddings, config);
		return new OracleVSStub(embeddings, config as OracleVSStubArgs);
	}
}

jest.mock('@oracle/langchain-oracledb', () => ({
	DistanceStrategy: DistanceStrategyMock,
	OracleVS: OracleVSStub,
}));

type CapturedConfig = VectorStoreNodeConstructorArgs<OracleVSStub>;

type TestNodeInstance = {
	getVectorStoreClient: (
		context: IExecuteFunctions,
		filter: Record<string, never> | undefined,
		embeddings: Embeddings,
		itemIndex: number,
	) => Promise<OracleVSStub>;
	populateVectorStore: (
		context: IExecuteFunctions,
		embeddings: Embeddings,
		documents: Array<Document<Record<string, unknown>>>,
		itemIndex: number,
	) => Promise<void>;
};

let capturedConfig: CapturedConfig;

jest.mock('@n8n/ai-utilities', () => {
	const actual = jest.requireActual('@n8n/ai-utilities');
	return {
		...actual,
		metadataFilterField: {},
		createVectorStoreNode: (config: CapturedConfig) => {
			capturedConfig = config;

			return class TestVectorStoreNode {
				async getVectorStoreClient(
					context: IExecuteFunctions,
					filter: Record<string, never> | undefined,
					embeddings: Embeddings,
					itemIndex: number,
				) {
					return (await config.getVectorStoreClient(
						context,
						filter,
						embeddings,
						itemIndex,
					)) as OracleVSStub;
				}

				async populateVectorStore(
					context: IExecuteFunctions,
					embeddings: Embeddings,
					docs: Array<Document<Record<string, unknown>>>,
					itemIndex: number,
				) {
					await config.populateVectorStore(context, embeddings, docs, itemIndex);
				}
			} as unknown as new () => TestNodeInstance;
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
	const documents: Array<Document<Record<string, unknown>>> = [
		{ pageContent: 'first', metadata: { id: 1 } },
		{ pageContent: 'second', metadata: { id: 2 } },
	];
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

	const createNode = () => new VectorStoreOracleDB() as unknown as TestNodeInstance;

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
		ConnectionPoolManager.getInstance(context.logger).purgeConnections();
	});

	it('passes configuration to ExtendedOracleDBVectorStore.initialize', async () => {
		const node = createNode();
		const filter = { project: 'n8n' } as unknown as Record<string, never>;

		const vectorStore = await node.getVectorStoreClient(context, filter, embeddings, 0);

		if (createPoolMock.mock.calls.length > 0) {
			const poolConfig = createPoolMock.mock.calls[0][0] as Record<string, unknown>;
			expect(poolConfig).toMatchObject({
				user: 'user',
				password: 'pw',
				connectionString: baseCredentials.connectionString,
			});
			expect(poolConfig).not.toHaveProperty('useThickMode');
		}

		expect(initializeSpy).toHaveBeenCalledTimes(1);
		const initArgs = initializeSpy.mock.calls[0][1];
		expect(initArgs).toMatchObject({
			client: vectorStore.client,
			tableName: 'n8n_vectors',
			query: 'n8n vector store initialization text',
			filter,
			distanceStrategy: DistanceStrategyMock.DOT_PRODUCT,
		});
		expect(vectorStore).toBeInstanceOf(OracleVSStub);
	});

	it('passes array metadata filters without $in operator', async () => {
		const node = createNode();
		const filter = {
			author: ['Andrew Ng', 'Demis Hassabis'],
		} as unknown as Record<string, never>;

		await node.getVectorStoreClient(context, filter, embeddings, 0);

		const initArgs = initializeSpy.mock.calls.at(-1)?.[1];
		expect(initArgs?.filter).toEqual(filter);
	});

	it('passes metadata filters using $nin operator', async () => {
		const node = createNode();
		const filter = {
			author: { $nin: ['Andrew Ng', 'Demis Hassabis'] },
		} as unknown as Record<string, never>;

		await node.getVectorStoreClient(context, filter, embeddings, 0);

		const initArgs = initializeSpy.mock.calls.at(-1)?.[1];
		expect(initArgs?.filter).toEqual(filter);
	});

	it('populates vector store using OracleVS.fromDocuments with proper config', async () => {
		const node = createNode();

		await node.populateVectorStore(context, embeddings, documents, 0);

		const call = fromDocumentsSpy.mock.calls[0];
		expect(call[0]).toBe(documents);
		expect(call[1]).toBe(embeddings);
		expect(call[2]).toEqual(
			expect.objectContaining({
				tableName: 'n8n_vectors',
				query: 'n8n vector store initialization text',
			}),
		);

		if (createdPools[0]) {
			expect(call?.[2]?.client).toBe(createdPools[0]);
		}

		const poolClose = poolCloseMocks[0];
		if (poolClose) {
			expect(poolClose).toHaveBeenCalled();
		}
	});

	it('merges stored filter with ad-hoc filter for similarity search', async () => {
		const node = createNode();
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
		const node = createNode();
		await node.getVectorStoreClient(context, undefined, embeddings, 0);

		const poolClose = poolCloseMocks[0];
		const lastInstance = OracleVSStub.instances[OracleVSStub.instances.length - 1];
		if (poolClose && lastInstance) {
			expect(poolClose).not.toHaveBeenCalled();
			capturedConfig.releaseVectorStoreClient?.(lastInstance);
			expect(poolClose).toHaveBeenCalled();
		}
	});
});
