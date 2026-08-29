import type { ICredentialType, INodeProperties } from 'n8n-workflow';

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
			displayName: 'Inference Endpoint (Advanced)',
			name: 'serviceEndpoint',
			type: 'string',
			default: '',
			placeholder: 'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com',
			description: 'Optional. Leave empty to use the OCI endpoint for the Region ID.',
		},
	];
}
