import { UserError, type ICredentialDataDecryptedObject } from 'n8n-workflow';
import * as common from 'oci-common';
import * as genai from 'oci-generativeai';
import * as genaiInference from 'oci-generativeaiinference';

const OCI_MODEL_OCID_PATTERN =
	/^ocid[0-9]+\.generativeaimodel\.oc[0-9]+(?:\.[a-z0-9_-]*)*\.[a-z0-9_-]+$/i;
const OCI_PROVIDER_MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._+-]*$/i;
const OCI_VENDOR_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const OCI_COMPARTMENT_OCID_PATTERN =
	/^ocid[0-9]+\.(?:compartment|tenancy)\.oc[0-9]+(?:\.[a-z0-9_-]*)*\.[a-z0-9_-]+$/i;
const MAX_OCI_OCID_LENGTH = 256;
// Searchable selectors invoke list search per keystroke; retain a small, short-lived catalog.
const MODEL_CATALOG_CACHE_TTL_MS = 60_000;
const MAX_MODEL_CATALOG_CACHE_ENTRIES = 100;
const MAX_MODEL_CATALOG_PAGES_PER_ENTRY = 20;
export const OCI_INFERENCE_CLIENT_CACHE_TTL_MS = 60_000;
const MAX_INFERENCE_CLIENT_CACHE_ENTRIES = 32;

export type OciEmbeddingModelCapabilities = {
	outputDimensions?: readonly number[];
};

/**
 * Known embedding model capabilities until OCI exposes reliable capability metadata.
 * Keep this fallback aligned with OCI model documentation.
 */
const OCI_EMBEDDING_MODEL_CAPABILITIES: Readonly<Record<string, OciEmbeddingModelCapabilities>> = {
	'cohere.embed-v4.0': {
		outputDimensions: [256, 512, 1024, 1536],
	},
};

export interface OciGenAiCredentials {
	authentication: 'apiKey' | 'instancePrincipal' | 'resourcePrincipal' | 'session';
	tenancyId?: string;
	userId?: string;
	fingerprint?: string;
	privateKey?: string;
	passphrase?: string;
	configFilePath?: string;
	configProfile?: string;
	regionId: string;
	serviceEndpoint?: string;
}

export function validateOciModelId(modelId: string): string {
	const normalized = modelId.trim();
	if (!normalized) {
		throw new UserError('OCI model ID is required');
	}
	if (normalized.length > 256) {
		throw new UserError('OCI model ID is too long (maximum 256 characters)');
	}
	if ([...normalized].some((character) => character.charCodeAt(0) < 0x20 || character === '\x7f')) {
		throw new UserError('OCI model ID contains invalid control characters');
	}
	if (!OCI_MODEL_OCID_PATTERN.test(normalized) && !OCI_PROVIDER_MODEL_ID_PATTERN.test(normalized)) {
		throw new UserError(`Invalid OCI Generative AI model ID: "${normalized}"`);
	}
	return normalized;
}

/** Normalizes the optional OCI management API vendor filter before model discovery. */
export function validateOciVendor(vendor: string | undefined): string | undefined {
	const normalized = vendor?.trim().toLowerCase();
	if (!normalized) return undefined;

	if (!OCI_VENDOR_PATTERN.test(normalized)) {
		throw new UserError(
			'OCI vendor must contain only letters, numbers, hyphens, and underscores (maximum 64 characters)',
		);
	}

	return normalized;
}

/** Returns capabilities for the selected embedding model when n8n has a verified fallback. */
export function getOciEmbeddingModelCapabilities(
	modelId: string,
): OciEmbeddingModelCapabilities | undefined {
	return OCI_EMBEDDING_MODEL_CAPABILITIES[modelId.toLowerCase()];
}

/** Returns model IDs that expose verified output-dimension controls. */
export function getOciEmbeddingModelIdsWithOutputDimensions(): readonly string[] {
	return Object.entries(OCI_EMBEDDING_MODEL_CAPABILITIES)
		.filter(([, capabilities]) => capabilities.outputDimensions !== undefined)
		.map(([modelId]) => modelId);
}

export function validateOciCompartmentId(compartmentId: string): string {
	const normalized = compartmentId.trim();
	if (!normalized) {
		throw new UserError('Compartment OCID is required');
	}
	if (normalized.length > MAX_OCI_OCID_LENGTH) {
		throw new UserError('Compartment OCID is too long (maximum 256 characters)');
	}
	if ([...normalized].some((character) => character.charCodeAt(0) < 0x20 || character === '\x7f')) {
		throw new UserError('Compartment OCID contains invalid control characters');
	}
	if (!OCI_COMPARTMENT_OCID_PATTERN.test(normalized)) {
		throw new UserError('Invalid OCI Compartment OCID');
	}
	return normalized;
}

function getExpectedOciInferenceEndpointHost(regionId: string): string {
	let region: common.Region;
	try {
		region = common.Region.fromRegionId(regionId.trim());
	} catch {
		throw new UserError('Region ID must be a valid OCI region');
	}

	if (!region) {
		throw new UserError('Region ID must be a valid OCI region');
	}

	return `inference.generativeai.${region.regionId}.oci.${region.realm.secondLevelDomain}`;
}

export function validateOciEndpoint(
	endpoint: string | undefined,
	regionId: string,
): string | undefined {
	const normalized = endpoint?.trim();
	if (!normalized) return undefined;

	let url: URL;
	try {
		url = new URL(normalized);
	} catch {
		throw new UserError('Inference endpoint must be a valid URL');
	}

	if (url.protocol !== 'https:') {
		throw new UserError('Inference endpoint must use HTTPS');
	}
	// OCI clients sign outbound requests, so endpoint overrides must match the selected region's realm.
	if (url.hostname !== getExpectedOciInferenceEndpointHost(regionId)) {
		throw new UserError('Inference endpoint must match the configured OCI region and realm');
	}
	if (url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
		throw new UserError(
			'Inference endpoint must not include credentials, a port, a path, a query, or a fragment',
		);
	}

	return url.origin;
}

export type OciGenAiCatalogModel = {
	id: string;
	vendor?: string;
	displayName?: string;
	timeOnDemandRetired?: Date | string | null;
};

type OciGenAiModelCatalogPage = {
	models: OciGenAiCatalogModel[];
	searchModels: OciGenAiSearchModel[];
	nextPage?: string;
};

type CachedModelCatalog = {
	expiresAt: number;
	pages: Map<string, Promise<OciGenAiModelCatalogPage>>;
};

type CachedInferenceClient = {
	// Expiration removes this client from reuse, but does not close it while workflows may still use it.
	expiresAt: number;
	clientPromise: Promise<genaiInference.GenerativeAiInferenceClient>;
};

const modelCatalogCache = new Map<string, CachedModelCatalog>();
const inferenceClientCache = new Map<string, CachedInferenceClient>();

export type OciGenAiSearchModel = {
	id: string;
	name: string;
	searchText: string;
};

export type OciGenAiOnDemandEmbeddingModel = {
	displayName: string;
	modelId: string;
	regions: string[];
};

/**
 * Verified on-demand embedding models for the n8n selector.
 *
 * This is intentionally curated rather than derived from listModels(), because the OCI management
 * catalog does not provide enough information to reliably distinguish on-demand availability by region.
 * Keep this list aligned with OCI Models by Region. Manual model ID entry remains available for new models.
 */
const OCI_VERIFIED_ON_DEMAND_EMBEDDING_MODELS: OciGenAiOnDemandEmbeddingModel[] = [
	{
		displayName: 'Cohere Embed 4',
		modelId: 'cohere.embed-v4.0',
		regions: ['us-ashburn-1', 'us-chicago-1', 'me-abudhabi-1', 'me-riyadh-1', 'ap-osaka-1'],
	},
	{
		displayName: 'Cohere Embed English 3 (Deprecated)',
		modelId: 'cohere.embed-english-v3.0',
		regions: ['us-chicago-1', 'sa-saopaulo-1', 'eu-frankfurt-1', 'uk-london-1', 'ap-osaka-1'],
	},
	{
		displayName: 'Cohere Embed English Light 3 (Deprecated)',
		modelId: 'cohere.embed-english-light-v3.0',
		regions: ['us-chicago-1'],
	},
	{
		displayName: 'Cohere Embed Multilingual 3 (Deprecated)',
		modelId: 'cohere.embed-multilingual-v3.0',
		regions: ['us-chicago-1', 'sa-saopaulo-1', 'eu-frankfurt-1', 'uk-london-1', 'ap-osaka-1'],
	},
	{
		displayName: 'Cohere Embed Multilingual Light 3 (Deprecated)',
		modelId: 'cohere.embed-multilingual-light-v3.0',
		regions: ['us-chicago-1'],
	},
];

export function isOnDemandModelAvailable(model: OciGenAiCatalogModel): boolean {
	if (model.timeOnDemandRetired == null) return true;

	const retiredAt =
		typeof model.timeOnDemandRetired === 'string'
			? Date.parse(model.timeOnDemandRetired)
			: model.timeOnDemandRetired.getTime();

	return Number.isNaN(retiredAt) || retiredAt > Date.now();
}

export function getOnDemandModelId(model: OciGenAiCatalogModel): string {
	if (!model.id.startsWith('ocid1.generativeaimodel.')) {
		return model.id;
	}

	const vendor = model.vendor?.trim();
	const displayName = model.displayName?.trim();
	if (!vendor || !displayName) {
		return '';
	}

	// Management APIs can return a model OCID while inference requires its provider model ID.
	const modelName = (
		displayName.toLowerCase().startsWith(vendor.toLowerCase())
			? displayName.slice(vendor.length).trim()
			: displayName
	).replace(/^[^a-z0-9]+/i, '');

	return `${vendor}.${modelName}`
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9.+-]/g, '');
}

function normalizeOciModelCatalog(models: OciGenAiCatalogModel[]): OciGenAiSearchModel[] {
	// Normalize once when the cache is populated so typeahead only performs a substring check.
	return models
		.filter(isOnDemandModelAvailable)
		.flatMap((model): OciGenAiSearchModel[] => {
			const id = getOnDemandModelId(model);
			if (!id) return [];

			try {
				const validatedId = validateOciModelId(id);
				const name = model.displayName || validatedId || 'OCI Chat Model';
				return [{ id: validatedId, name, searchText: `${name} ${validatedId}`.toLowerCase() }];
			} catch {
				return [];
			}
		})
		.sort((first, second) => first.name.localeCompare(second.name));
}

export function getOnDemandEmbeddingModels(
	regionId: string,
	filter?: string,
): OciGenAiOnDemandEmbeddingModel[] {
	const normalizedRegionId = regionId.trim().toLowerCase();
	const normalizedFilter = filter?.trim().toLowerCase() ?? '';

	return OCI_VERIFIED_ON_DEMAND_EMBEDDING_MODELS.filter(
		(model) =>
			model.regions.includes(normalizedRegionId) &&
			(!normalizedFilter ||
				model.displayName.toLowerCase().includes(normalizedFilter) ||
				model.modelId.includes(normalizedFilter)),
	);
}

export function isOciGenAiCredentials(
	credentials: ICredentialDataDecryptedObject,
): credentials is ICredentialDataDecryptedObject & OciGenAiCredentials {
	return (
		(credentials.authentication === 'apiKey' ||
			credentials.authentication === 'instancePrincipal' ||
			credentials.authentication === 'resourcePrincipal' ||
			credentials.authentication === 'session') &&
		typeof credentials.regionId === 'string'
	);
}

function required(credentials: OciGenAiCredentials, name: keyof OciGenAiCredentials): string {
	const value = credentials[name];
	if (typeof value !== 'string' || value.trim() === '') {
		throw new UserError(`OCI Generative AI credential "${name}" is required`);
	}
	return value.trim();
}

function sanitizePrivateKey(rawKey: string): string {
	let key = rawKey.trim();
	// Credentials pasted as JSON commonly preserve line breaks as literal escape sequences.
	if (key.includes('\\n')) {
		key = key.replace(/\\n/g, '\n');
	}
	return key;
}

async function getAuthenticationDetailsProvider(
	credentials: OciGenAiCredentials,
): Promise<common.AuthenticationDetailsProvider> {
	switch (credentials.authentication) {
		case 'apiKey': {
			const privateKey = sanitizePrivateKey(required(credentials, 'privateKey'));
			return new common.SimpleAuthenticationDetailsProvider(
				required(credentials, 'tenancyId'),
				required(credentials, 'userId'),
				required(credentials, 'fingerprint'),
				privateKey,
				credentials.passphrase ? credentials.passphrase.trim() : null,
				common.Region.fromRegionId(required(credentials, 'regionId')),
			);
		}
		case 'instancePrincipal':
			return await new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
		case 'resourcePrincipal':
			return common.ResourcePrincipalAuthenticationDetailsProvider.builder();
		case 'session':
			return new common.ConfigFileAuthenticationDetailsProvider(
				required(credentials, 'configFilePath'),
				required(credentials, 'configProfile'),
			);
		default:
			throw new UserError(
				`Unsupported OCI authentication method: ${String(credentials.authentication)}`,
			);
	}
}

// Keep construction separate so the cache can share initialization across model wrappers.
async function createOciGenAiClientInternal(
	credentials: OciGenAiCredentials,
): Promise<genaiInference.GenerativeAiInferenceClient> {
	const authenticationDetailsProvider = await getAuthenticationDetailsProvider(credentials);
	const client = new genaiInference.GenerativeAiInferenceClient({ authenticationDetailsProvider });

	if (credentials.regionId) {
		client.region = common.Region.fromRegionId(credentials.regionId.trim());
	}
	const endpoint = validateOciEndpoint(credentials.serviceEndpoint, credentials.regionId);
	if (endpoint) {
		client.endpoint = endpoint;
	}

	return client;
}

// Cache only non-secret identity and routing settings; model and compartment are request-specific.
function getInferenceClientCacheKey(credentials: OciGenAiCredentials): string {
	// Private key and passphrase stay out of cache keys. Fingerprint changes identify key rotation;
	// otherwise, the existing client can be reused only until this cache entry expires.
	const authenticationIdentity = getOciAuthenticationIdentity(credentials);
	const endpoint = validateOciEndpoint(credentials.serviceEndpoint, credentials.regionId) ?? '';

	return JSON.stringify([
		authenticationIdentity,
		credentials.regionId.trim().toLowerCase(),
		endpoint,
	]);
}

// Expiry stops new callers from reusing a client without interrupting active workflows.
function evictExpiredInferenceClients(now: number): void {
	for (const [key, cachedClient] of inferenceClientCache) {
		if (cachedClient.expiresAt <= now) {
			// Existing workflows can still hold the client, so do not close it during eviction.
			inferenceClientCache.delete(key);
		}
	}
}

// Agent tool calls rebuild LangChain wrappers, so reuse OCI client initialization across wrappers.
async function getCachedOciGenAiClient(
	credentials: OciGenAiCredentials,
): Promise<genaiInference.GenerativeAiInferenceClient> {
	const now = Date.now();
	evictExpiredInferenceClients(now);

	const key = getInferenceClientCacheKey(credentials);
	const cachedClient = inferenceClientCache.get(key);
	if (cachedClient) {
		return await cachedClient.clientPromise;
	}

	if (inferenceClientCache.size >= MAX_INFERENCE_CLIENT_CACHE_ENTRIES) {
		// Keep memory bounded with insertion-order eviction; the short TTL makes LRU unnecessary.
		const oldestEntry = inferenceClientCache.keys().next();
		if (!oldestEntry.done) {
			inferenceClientCache.delete(oldestEntry.value);
		}
	}

	const clientPromise = createOciGenAiClientInternal(credentials);
	inferenceClientCache.set(key, {
		expiresAt: now + OCI_INFERENCE_CLIENT_CACHE_TTL_MS,
		clientPromise,
	});
	void clientPromise.catch(() => {
		// Do not retain failed authentication or client initialization attempts.
		if (inferenceClientCache.get(key)?.clientPromise === clientPromise) {
			inferenceClientCache.delete(key);
		}
	});

	return await clientPromise;
}

// Preserve the shared client factory used by both OCI Chat and Embeddings nodes.
export async function createOciGenAiClient(
	credentials: OciGenAiCredentials,
): Promise<genaiInference.GenerativeAiInferenceClient> {
	return await getCachedOciGenAiClient(credentials);
}

// Reset module-level caches so unit tests do not depend on execution order.
export function clearOciGenAiCachesForTesting(): void {
	inferenceClientCache.clear();
	modelCatalogCache.clear();
}

export async function createOciGenAiModelClient(
	credentials: OciGenAiCredentials,
): Promise<genai.GenerativeAiClient> {
	const authenticationDetailsProvider = await getAuthenticationDetailsProvider(credentials);
	const client = new genai.GenerativeAiClient({ authenticationDetailsProvider });

	if (credentials.regionId) {
		client.region = common.Region.fromRegionId(credentials.regionId.trim());
	}

	return client;
}

// Both OCI caches need the same non-secret identity boundary.
function getOciAuthenticationIdentity(credentials: OciGenAiCredentials): string {
	switch (credentials.authentication) {
		case 'apiKey':
			return JSON.stringify(
				[
					credentials.authentication,
					credentials.tenancyId,
					credentials.userId,
					credentials.fingerprint,
				].map((value) => value?.trim() ?? ''),
			);
		case 'session':
			return JSON.stringify(
				[credentials.authentication, credentials.configFilePath, credentials.configProfile].map(
					(value) => value?.trim() ?? '',
				),
			);
		default:
			return credentials.authentication;
	}
}

// Expire catalog entries so dropdown data stays current without unbounded retention.
function evictExpiredModelCatalogs(now: number): void {
	for (const [key, catalog] of modelCatalogCache) {
		if (catalog.expiresAt <= now) {
			modelCatalogCache.delete(key);
		}
	}
}

// Share a short-lived catalog across typeahead requests for the same OCI scope.
function getModelCatalogCache(key: string, now: number): CachedModelCatalog {
	evictExpiredModelCatalogs(now);

	const cachedCatalog = modelCatalogCache.get(key);
	if (cachedCatalog) {
		return cachedCatalog;
	}

	if (modelCatalogCache.size >= MAX_MODEL_CATALOG_CACHE_ENTRIES) {
		// Keep memory bounded with insertion-order eviction; the short TTL makes LRU unnecessary.
		const oldestEntry = modelCatalogCache.keys().next();
		if (!oldestEntry.done) {
			modelCatalogCache.delete(oldestEntry.value);
		}
	}

	const catalog = {
		expiresAt: now + MODEL_CATALOG_CACHE_TTL_MS,
		pages: new Map(),
	};
	modelCatalogCache.set(key, catalog);
	return catalog;
}

// Cache model pages because searchable selectors call this once per typed character.
export async function getCachedOciGenAiModelCatalogPage(
	credentials: OciGenAiCredentials,
	{
		compartmentId,
		capability,
		vendor,
		paginationToken,
	}: {
		compartmentId: string;
		capability: genai.models.ModelCapability;
		vendor?: string;
		paginationToken?: string;
	},
): Promise<OciGenAiModelCatalogPage> {
	const normalizedVendor = validateOciVendor(vendor) ?? '';
	const cacheKey = JSON.stringify([
		getOciAuthenticationIdentity(credentials),
		credentials.regionId.trim().toLowerCase(),
		compartmentId,
		normalizedVendor,
		capability,
	]);
	const cachedCatalog = getModelCatalogCache(cacheKey, Date.now());
	const pageKey = paginationToken ?? '';
	const cachedPage = cachedCatalog.pages.get(pageKey);
	if (cachedPage) {
		// Reuse the promise too, preventing concurrent keystrokes from duplicating OCI requests.
		return await cachedPage;
	}

	if (cachedCatalog.pages.size >= MAX_MODEL_CATALOG_PAGES_PER_ENTRY) {
		// Page tokens are also evicted in insertion order to bound a single catalog entry.
		const oldestPage = cachedCatalog.pages.keys().next();
		if (!oldestPage.done) {
			cachedCatalog.pages.delete(oldestPage.value);
		}
	}

	const page = createOciGenAiModelClient(credentials)
		.then(async (client) => {
			const response = await client.listModels({
				compartmentId,
				capability: [capability],
				...(normalizedVendor ? { vendor: normalizedVendor } : {}),
				limit: 100,
				...(paginationToken ? { page: paginationToken } : {}),
			});

			const models = response.modelCollection.items ?? [];
			return {
				models,
				searchModels: normalizeOciModelCatalog(models),
				nextPage: response.opcNextPage,
			};
		})
		.catch((error: unknown) => {
			cachedCatalog.pages.delete(pageKey);
			throw error;
		});

	cachedCatalog.pages.set(pageKey, page);
	return await page;
}
