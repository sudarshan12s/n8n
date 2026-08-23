import * as common from 'oci-common';
import * as genai from 'oci-generativeai';
import type { ICredentialDataDecryptedObject } from 'n8n-workflow';

export interface OciGenAiCredentials extends ICredentialDataDecryptedObject {
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

function required(credentials: OciGenAiCredentials, name: keyof OciGenAiCredentials): string {
	const value = credentials[name];
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`OCI Generative AI credential "${name}" is required`);
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
			return await common.ResourcePrincipalAuthenticationDetailsProvider.builder();
		case 'session':
			return new common.ConfigFileAuthenticationDetailsProvider(
				required(credentials, 'configFilePath'),
				required(credentials, 'configProfile'),
			);
		default:
			throw new Error(
				`Unsupported OCI authentication method: ${String(credentials.authentication)}`,
			);
	}
}

export async function createOciGenAiClient(
	credentials: OciGenAiCredentials,
): Promise<genai.GenerativeAiInferenceClient> {
	const authenticationDetailsProvider = await getAuthenticationDetailsProvider(credentials);
	const client = new genai.GenerativeAiInferenceClient({ authenticationDetailsProvider });

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
	if (credentials.serviceEndpoint?.trim()) {
		client.endpoint = credentials.serviceEndpoint.trim();
	}

	return client;
}

export async function testOciGenAiConnection(credentials: OciGenAiCredentials): Promise<void> {
	const client = await createOciGenAiModelClient(credentials);
	// For apiKey auth, tenancyId is the root compartment OCID
	const testCompartment = credentials.tenancyId?.trim();
	if (testCompartment) {
		await client.listModels({ compartmentId: testCompartment, limit: 1 });
	}
}
