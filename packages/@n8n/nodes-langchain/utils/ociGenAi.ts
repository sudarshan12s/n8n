import { OciGenAiNewClientAuthType, OciGenAiSdkClient } from '@oracle/langchain-oci';
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
	compartmentId: string;
}

function required(credentials: OciGenAiCredentials, name: keyof OciGenAiCredentials): string {
	const value = credentials[name];

	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`OCI Generative AI credential "${name}" is required`);
	}

	return value.trim();
}

export async function createOciGenAiClient(
	credentials: OciGenAiCredentials,
): Promise<GenerativeAiInferenceClient> {
	// create auth provider according to n8n credentials...

	const client = new GenerativeAiInferenceClient({
		authenticationDetailsProvider,
	});

	client.regionId = credentials.regionId;

	if (credentials.serviceEndpoint) {
		client.endpoint = credentials.serviceEndpoint;
	}

	return client;
}

export async function createOciGenAiClient(
	credentials: OciGenAiCredentials,
): Promise<OciGenAiSdkClient> {
	const regionId = required(credentials, 'regionId');

	switch (credentials.authentication) {
		case 'apiKey':
			return await OciGenAiSdkClient.create({
				newClientParams: {
					authType: OciGenAiNewClientAuthType.ApiKey,
					regionId,
					serviceEndpoint: credentials.serviceEndpoint || undefined,
					authParams: {
						tenancyId: required(credentials, 'tenancyId'),
						userId: required(credentials, 'userId'),
						fingerprint: required(credentials, 'fingerprint'),
						privateKey: required(credentials, 'privateKey'),
						passphrase: credentials.passphrase || undefined,
					},
				},
			});

		case 'instancePrincipal':
			return await OciGenAiSdkClient.create({
				newClientParams: {
					authType: OciGenAiNewClientAuthType.InstancePrincipal,
					regionId,
					serviceEndpoint: credentials.serviceEndpoint || undefined,
				},
			});

		case 'resourcePrincipal':
			return await OciGenAiSdkClient.create({
				newClientParams: {
					authType: OciGenAiNewClientAuthType.ResourcePrincipal,
					regionId,
					serviceEndpoint: credentials.serviceEndpoint || undefined,
				},
			});

		case 'session':
			return await OciGenAiSdkClient.create({
				newClientParams: {
					authType: OciGenAiNewClientAuthType.Session,
					regionId,
					serviceEndpoint: credentials.serviceEndpoint || undefined,
					authParams: {
						clientConfigFilePath: required(credentials, 'configFilePath'),
						clientProfile: required(credentials, 'configProfile'),
					},
				},
			});

		default:
			throw new Error(
				`Unsupported OCI authentication method: ${String(credentials.authentication)}`,
			);
	}
}

export async function testOciGenAiConnection(credentials: OciGenAiCredentials): Promise<void> {
	const client = await createOciGenAiClient(credentials);

	try {
		const compartmentId = required(credentials, 'compartmentId');

		await client.client.listModels({
			compartmentId,
		});
	} finally {
		client.close();
	}
}
