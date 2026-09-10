import { HumanMessage } from '@langchain/core/messages';
import assert from 'node:assert/strict';
import process from 'node:process';
import type { INode, ISupplyDataFunctions } from 'n8n-workflow';
import { ConfigFileReader } from 'oci-common';

import { LmChatOciGenAi } from '../LmChatOciGenAi.node';
import type { OciGenAiCredentials } from '../../../../utils/ociGenAi';

function hasOciIntegrationConfig(): boolean {
	return Boolean(process.env.OCI_GENAI_MODEL && process.env.OCI_GENAI_COMPARTMENT_OCID);
}

function requiredEnv(name: string): string {
	const value = process.env[name];

	if (!value) {
		throw new Error(`Missing integration-test environment variable: ${name}`);
	}

	return value;
}

function getCredentials(): OciGenAiCredentials {
	const profile = process.env.OCI_CONFIG_PROFILE ?? 'DEFAULT';
	const config = ConfigFileReader.parseDefault(profile);
	const regionId = config.get('region');

	if (!regionId) {
		throw new Error(`OCI config profile "${profile}" does not define a region`);
	}

	return {
		// Let the OCI SDK load the default ~/.oci/config file, including its key path and passphrase.
		authentication: 'session',
		configFilePath: ConfigFileReader.DEFAULT_FILE_PATH,
		configProfile: profile,
		regionId,
		serviceEndpoint: process.env.OCI_INFERENCE_ENDPOINT,
	};
}

function createChatNodeContext(
	credentials: OciGenAiCredentials,
	model: string,
	compartmentId: string,
): ISupplyDataFunctions {
	const workflowNode: INode = {
		id: 'oci-integration-check',
		name: 'OCI Generative AI Chat Model integration check',
		type: '@n8n/n8n-nodes-langchain.lmChatOciGenAi',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	};

	return {
		getCredentials: async () => credentials,
		getNode: () => workflowNode,
		getNodeParameter: (name: string) => {
			if (name === 'model') return model;
			if (name === 'compartmentId') return compartmentId;
			if (name === 'servingMode') return 'onDemand';
			if (name === 'options') return {};
			return '';
		},
	} as unknown as ISupplyDataFunctions;
}

type InvokableChatModel = {
	invoke(messages: HumanMessage[]): Promise<{ content: unknown }>;
};

function isInvokableChatModel(value: unknown): value is InvokableChatModel {
	return (
		typeof value === 'object' &&
		value !== null &&
		'invoke' in value &&
		typeof value.invoke === 'function'
	);
}

async function run(): Promise<void> {
	if (!hasOciIntegrationConfig()) {
		console.log('[OCI INT TEST] Skipped: OCI integration environment is not configured.');
		return;
	}

	const credentials = getCredentials();
	const model = requiredEnv('OCI_GENAI_MODEL');
	const compartmentId = requiredEnv('OCI_GENAI_COMPARTMENT_OCID');
	const chatNode = new LmChatOciGenAi();
	const result = await chatNode.supplyData.call(
		createChatNodeContext(credentials, model, compartmentId),
		0,
	);

	assert.ok(
		isInvokableChatModel(result.response),
		'The chat node did not return an invokable model',
	);

	const response = await result.response.invoke([
		new HumanMessage('Reply with exactly: OCI integration test passed'),
	]);

	assert.ok(response.content, 'The OCI chat model returned empty content');
	console.log('[OCI INT TEST] OCI chat integration passed.');
}

run().catch((error: unknown) => {
	console.error('[OCI INT TEST] OCI chat integration failed:', error);
	process.exitCode = 1;
});
