import { UserError, type ICredentialDataDecryptedObject } from 'n8n-workflow';
import * as common from 'oci-common';
import * as genai from 'oci-generativeai';
import * as genaiInference from 'oci-generativeaiinference';

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

export type OciGenAiCatalogModel = {
	id: string;
	vendor?: string;
	displayName?: string;
	timeOnDemandRetired?: Date | string | null;
};

export type OciGenAiOnDemandEmbeddingModel = {
	displayName: string;
	modelId: string;
	regions: string[];
};

const ON_DEMAND_EMBEDDING_MODELS: OciGenAiOnDemandEmbeddingModel[] = [
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

export function getOnDemandEmbeddingModels(
	regionId: string,
	filter?: string,
): OciGenAiOnDemandEmbeddingModel[] {
	const normalizedRegionId = regionId.trim().toLowerCase();
	const normalizedFilter = filter?.trim().toLowerCase() ?? '';

	return ON_DEMAND_EMBEDDING_MODELS.filter(
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

export async function createOciGenAiClient(
	credentials: OciGenAiCredentials,
): Promise<genaiInference.GenerativeAiInferenceClient> {
	const authenticationDetailsProvider = await getAuthenticationDetailsProvider(credentials);
	const client = new genaiInference.GenerativeAiInferenceClient({ authenticationDetailsProvider });

	if (credentials.regionId) {
		client.region = common.Region.fromRegionId(credentials.regionId.trim());
	}
	if (credentials.serviceEndpoint?.trim()) {
		client.endpoint = credentials.serviceEndpoint.trim();
	}

	return client;
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
