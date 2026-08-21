import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class OciGenAiApi implements ICredentialType {
	name = 'ociGenAiApi';

	displayName = 'OCI Generative AI';

	documentationUrl = 'https://docs.oracle.com/en-us/iaas/Content/generative-ai/home.htm';

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
					name: 'Session',
					value: 'session',
				},
			],
			default: 'apiKey',
			description: 'Authentication method used to access OCI Generative AI.',
		},

		// ---------------------------------------------------------------------
		// API Key authentication
		// ---------------------------------------------------------------------
		{
			displayName: 'Tenancy OCID',
			name: 'tenancyId',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'ocid1.tenancy.oc1..aaaa...',
			displayOptions: {
				show: {
					authentication: ['apiKey'],
				},
			},
			description: 'OCID of the OCI tenancy.',
		},
		{
			displayName: 'User OCID',
			name: 'userId',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'ocid1.user.oc1..aaaa...',
			displayOptions: {
				show: {
					authentication: ['apiKey'],
				},
			},
			description: 'OCID of the OCI user associated with the API signing key.',
		},
		{
			displayName: 'Fingerprint',
			name: 'fingerprint',
			type: 'string',
			default: '',
			required: true,
			placeholder: '12:34:56:78:90:ab:cd:ef:...',
			displayOptions: {
				show: {
					authentication: ['apiKey'],
				},
			},
			description: 'Fingerprint of the OCI API signing key.',
		},
		{
			displayName: 'Private Key',
			name: 'privateKey',
			type: 'string',
			default: '',
			required: true,
			typeOptions: {
				password: true,
				rows: 8,
			},
			displayOptions: {
				show: {
					authentication: ['apiKey'],
				},
			},
			placeholder: '-----BEGIN PRIVATE KEY-----',
			description: 'PEM-encoded private key used to sign OCI API requests.',
		},
		{
			displayName: 'Passphrase',
			name: 'passphrase',
			type: 'string',
			default: '',
			typeOptions: {
				password: true,
			},
			displayOptions: {
				show: {
					authentication: ['apiKey'],
				},
			},
			description: 'Optional passphrase for the private key if the key is encrypted.',
		},

		// ---------------------------------------------------------------------
		// Session authentication
		// ---------------------------------------------------------------------
		{
			displayName: 'Config File Path',
			name: 'configFilePath',
			type: 'string',
			default: '',
			required: true,
			placeholder: '~/.oci/config',
			displayOptions: {
				show: {
					authentication: ['session'],
				},
			},
			description: 'Path to the OCI CLI/SDK configuration file accessible from the n8n runtime.',
		},
		{
			displayName: 'Config Profile',
			name: 'configProfile',
			type: 'string',
			default: 'DEFAULT',
			required: true,
			displayOptions: {
				show: {
					authentication: ['session'],
				},
			},
			description: 'Profile in the OCI configuration file containing the session credentials.',
		},

		// ---------------------------------------------------------------------
		// Common configuration
		// ---------------------------------------------------------------------
		{
			displayName: 'Region',
			name: 'regionId',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'us-chicago-1',
			description: 'OCI region used by the Generative AI service, for example us-chicago-1.',
		},
		{
			displayName: 'Service Endpoint',
			name: 'serviceEndpoint',
			type: 'string',
			default: '',
			placeholder: 'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com',
			description:
				'Optional override for the OCI Generative AI service endpoint. Leave empty to use the standard endpoint for the selected region.',
		},
	];
}
