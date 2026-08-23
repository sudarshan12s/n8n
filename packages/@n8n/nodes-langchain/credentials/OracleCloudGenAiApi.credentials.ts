import type {
	IAllExecuteFunctions,
	ICredentialDataDecryptedObject,
	ICredentialsDecrypted,
	ICredentialType,
	INodeCredentialTestResult,
	INodeProperties,
} from 'n8n-workflow';
import * as common from 'oci-common';
import * as genai from 'oci-generativeai';

export class OracleCloudGenAiApi implements ICredentialType {
	name = 'ociGenAiApi';
	displayName = 'OCI Generative AI API';
	documentationUrl = 'https://docs.oracle.com/en-us/iaas/Content/generative-ai/overview.htm';

	properties: INodeProperties[] = [
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'options',
			options: [
				{
					name: 'API Key',
					value: 'apiKey',
				},
				{
					name: 'Instance Principal',
					value: 'instancePrincipal',
				},
				{
					name: 'Resource Principal',
					value: 'resourcePrincipal',
				},
				{
					name: 'Session Token / Config File',
					value: 'session',
				},
			],
			default: 'apiKey',
		},
		{
			displayName: 'Tenancy OCID',
			name: 'tenancyId',
			type: 'string',
			displayOptions: {
				show: {
					authentication: ['apiKey'],
				},
			},
			default: '',
			required: true,
		},
		{
			displayName: 'User OCID',
			name: 'userId',
			type: 'string',
			displayOptions: {
				show: {
					authentication: ['apiKey'],
				},
			},
			default: '',
			required: true,
		},
		{
			displayName: 'Fingerprint',
			name: 'fingerprint',
			type: 'string',
			displayOptions: {
				show: {
					authentication: ['apiKey'],
				},
			},
			default: '',
			required: true,
		},
		{
			displayName: 'Private Key',
			name: 'privateKey',
			type: 'string',
			typeOptions: {
				password: true,
				rows: 4,
			},
			displayOptions: {
				show: {
					authentication: ['apiKey'],
				},
			},
			default: '',
			required: true,
		},
		{
			displayName: 'Passphrase',
			name: 'passphrase',
			type: 'string',
			typeOptions: {
				password: true,
			},
			displayOptions: {
				show: {
					authentication: ['apiKey'],
				},
			},
			default: '',
		},
		{
			displayName: 'Config File Path',
			name: 'configFilePath',
			type: 'string',
			displayOptions: {
				show: {
					authentication: ['session'],
				},
			},
			default: '~/.oci/config',
			required: true,
		},
		{
			displayName: 'Config Profile',
			name: 'configProfile',
			type: 'string',
			displayOptions: {
				show: {
					authentication: ['session'],
				},
			},
			default: 'DEFAULT',
			required: true,
		},
		{
			displayName: 'Region ID',
			name: 'regionId',
			type: 'string',
			default: 'us-chicago-1',
			required: true,
		},
		{
			displayName: 'Service Endpoint',
			name: 'serviceEndpoint',
			type: 'string',
			default: '',
			placeholder: 'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com',
			description: 'Custom endpoint URL if using a private endpoint or non-default region route',
		},
	];

	// Custom credential test methods mapping
	credentialTest = {
		async testConnection(
			this: IAllExecuteFunctions,
			credentialData: ICredentialsDecrypted<ICredentialDataDecryptedObject>,
		): Promise<INodeCredentialTestResult> {
			try {
				const data = (credentialData.data ?? credentialData) as Record<string, string>;
				const authMethod = data.authentication;
				const regionId = data.regionId?.trim();

				let authProvider: common.AuthenticationDetailsProvider;

				if (authMethod === 'apiKey') {
					let privateKey = data.privateKey?.trim() ?? '';
					if (privateKey.includes('\\n')) {
						privateKey = privateKey.replace(/\\n/g, '\n');
					}

					authProvider = new common.SimpleAuthenticationDetailsProvider(
						data.tenancyId?.trim(),
						data.userId?.trim(),
						data.fingerprint?.trim(),
						privateKey,
						data.passphrase?.trim() || null,
						common.Region.fromRegionId(regionId),
					);
				} else if (authMethod === 'instancePrincipal') {
					authProvider =
						await new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
				} else if (authMethod === 'resourcePrincipal') {
					authProvider = common.ResourcePrincipalAuthenticationDetailsProvider.builder();
				} else if (authMethod === 'session') {
					authProvider = new common.ConfigFileAuthenticationDetailsProvider(
						data.configFilePath?.trim(),
						data.configProfile?.trim(),
					);
				} else {
					throw new Error(`Unsupported authentication method: ${authMethod}`);
				}

				const client = new genai.GenerativeAiClient({
					authenticationDetailsProvider: authProvider,
				});

				if (regionId) {
					client.region = common.Region.fromRegionId(regionId);
				}

				if (data.serviceEndpoint?.trim()) {
					client.endpoint = data.serviceEndpoint.trim();
				}

				const compartmentId = data.tenancyId?.trim();
				if (compartmentId) {
					await client.listModels({ compartmentId, limit: 1 });
				}

				return {
					status: 'OK',
					message: 'Connection successful',
				};
			} catch (error) {
				return {
					status: 'Error',
					message: (error as Error).message || 'Connection failed',
				};
			}
		},
	};
}
