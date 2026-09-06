import { HumanMessage } from '@langchain/core/messages';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import process from 'node:process';
import type { INode, ISupplyDataFunctions } from 'n8n-workflow';
import { ConfigFileReader } from 'oci-common';

import { LmChatOciGenAi } from '../LmChatOciGenAi.node';
import type { OciGenAiCredentials } from '../../../../utils/ociGenAi';

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

function getModel(): string {
	return requiredEnv('OCI_GENAI_MODEL');
}

function getCompartmentId(): string {
	return requiredEnv('OCI_GENAI_COMPARTMENT_OCID');
}

function getCommandOutput(command: string, args: string[]): string {
	try {
		return execFileSync(command, args, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	} catch (error) {
		// lsof uses exit code 1 when no matching files exist, which means no sockets are open.
		if (typeof error === 'object' && error !== null && 'status' in error && error.status === 1) {
			return '';
		}

		throw new Error(
			`Failed to execute "${command}": ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function getEstablishedTcpConnections(): string[] {
	const pid = String(process.pid);

	/*
	 * macOS/Linux:
	 *
	 * lsof columns include:
	 * COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
	 *
	 * We deliberately use -nP here:
	 *   -n = don't do DNS resolution
	 *   -P = don't resolve ports
	 *
	 * This makes the output deterministic and lets us inspect the
	 * actual remote IP addresses.
	 */
	const output = getCommandOutput('lsof', [
		'-nP',
		'-a',
		'-p',
		pid,
		'-iTCP:443',
		'-sTCP:ESTABLISHED',
	]);

	return output
		.split('\n')
		.slice(1)
		.map((line) => line.trim())
		.filter(Boolean);
}

function printSocketSnapshot(label: string): void {
	const connections = getEstablishedTcpConnections();

	console.log(`\n[OCI INT TEST] ${label}`);
	console.log(`[OCI INT TEST] PID: ${process.pid}`);
	console.log(`[OCI INT TEST] Established TCP/443 connections: ${connections.length}`);

	for (const connection of connections) {
		console.log(`[OCI INT TEST] ${connection}`);
	}
}

async function getOciEndpointIp(credentials: OciGenAiCredentials): Promise<string | undefined> {
	/*
	 * If you're using the default regional endpoint, resolve the
	 * hostname derived from Region. If you supplied an endpoint,
	 * resolve that instead.
	 */
	const endpoint =
		credentials.serviceEndpoint ??
		`https://inference.generativeai.${credentials.regionId}.oci.oraclecloud.com`;

	const url = new URL(endpoint);

	const result = await lookup(url.hostname, {
		family: 4,
	});

	return result.address;
}

function createChatNodeContext(
	credentials: OciGenAiCredentials,
	model: string,
	compartmentId: string,
): ISupplyDataFunctions {
	const workflowNode: INode = {
		id: 'oci-socket-check',
		name: 'OCI Generative AI Chat Model socket check',
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

function printOciConnections(ociIp: string, label: string): void {
	const connections = getEstablishedTcpConnections();

	const ociConnections = connections.filter((connection) => connection.includes(ociIp));

	console.log(`\n[OCI INT TEST] ${label}`);
	console.log(`[OCI INT TEST] OCI endpoint IP: ${ociIp}`);
	console.log(`[OCI INT TEST] OCI TCP/443 connections: ${ociConnections.length}`);

	for (const connection of ociConnections) {
		console.log(`[OCI INT TEST] ${connection}`);
	}
}

async function run(): Promise<void> {
	const credentials = getCredentials();
	const model = getModel();
	const compartmentId = getCompartmentId();
	const ociIp = await getOciEndpointIp(credentials);
	const chatNode = new LmChatOciGenAi();

	console.log(`\n[OCI INT TEST] Current PID: ${process.pid}`);
	printSocketSnapshot('before OCI chat-node creation');

	if (ociIp) {
		printOciConnections(ociIp, 'before OCI chat-node creation');
	}

	const firstResult = await chatNode.supplyData.call(
		createChatNodeContext(credentials, model, compartmentId),
		0,
	);
	const firstModel = firstResult.response;
	assert.ok(isInvokableChatModel(firstModel), 'The chat node did not return an invokable model');

	console.log('[OCI INT TEST] Created chat model through LmChatOciGenAi.supplyData()');
	printSocketSnapshot('after OCI chat-node creation');

	if (ociIp) {
		printOciConnections(ociIp, 'after OCI chat-node creation');
	}

	const firstResponse = await firstModel.invoke([
		new HumanMessage('Reply with exactly: OCI connectivity test passed'),
	]);

	console.log('[OCI INT TEST] First response:', firstResponse.content);
	printSocketSnapshot('after first chat-node request');

	if (ociIp) {
		printOciConnections(ociIp, 'after first chat-node request');
	}

	// Reuse the same wrapper after its OCI SDK client has been initialized.
	const secondResponseSameWrapper = await firstModel.invoke([
		new HumanMessage('Reply with exactly: same wrapper reuse passed'),
	]);

	console.log(
		'[OCI INT TEST] Second response using same wrapper:',
		secondResponseSameWrapper.content,
	);
	printSocketSnapshot('after second request using same chat wrapper');

	if (ociIp) {
		printOciConnections(ociIp, 'after second request using same chat wrapper');
	}

	// New wrappers begin uninitialized but receive the n8n-cached OCI inference client.
	const wrapperCount = 10;
	const models = [] as Array<typeof firstModel>;

	for (let i = 0; i < wrapperCount; i++) {
		const result = await chatNode.supplyData.call(
			createChatNodeContext(credentials, model, compartmentId),
			0,
		);
		assert.ok(
			isInvokableChatModel(result.response),
			'The chat node did not return an invokable model',
		);
		models.push(result.response);
		console.log(`[OCI INT TEST] Created chat model through node #${i + 2}`);
	}

	printSocketSnapshot('after creating additional chat-node models');

	if (ociIp) {
		printOciConnections(ociIp, 'after creating additional chat-node models');
	}

	for (let i = 0; i < models.length; i++) {
		const response = await models[i].invoke([
			new HumanMessage(`Reply with exactly: wrapper ${i + 1} passed`),
		]);
		console.log(`[OCI INT TEST] wrapper #${i + 2} response:`, response.content);
	}

	printSocketSnapshot('after all chat-node requests');

	if (ociIp) {
		printOciConnections(ociIp, 'after all chat-node requests');
	}

	// Run all wrappers concurrently to observe how the OCI HTTP transport scales connections.
	const concurrentResponses = await Promise.all(
		models.map(async (chatModel, index) => {
			return await chatModel.invoke([
				new HumanMessage(`Reply with exactly: concurrent wrapper ${index + 1} passed`),
			]);
		}),
	);

	console.log(
		`[OCI INT TEST] Completed ${concurrentResponses.length} concurrent chat-node requests`,
	);
	printSocketSnapshot('after concurrent chat-node requests');

	if (ociIp) {
		printOciConnections(ociIp, 'after concurrent chat-node requests');
	}

	assert.ok(firstResponse);
	assert.ok(secondResponseSameWrapper);
	assert.equal(concurrentResponses.length, wrapperCount);
}

run().catch((error: unknown) => {
	console.error('[OCI INT TEST] Socket check failed:', error);
	process.exitCode = 1;
});
