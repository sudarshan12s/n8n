import type {
	ICredentialDataDecryptedObject,
	ICredentialsDecrypted,
	ICredentialTestFunctions,
} from 'n8n-workflow';
import { models as ociModels } from 'oci-generativeai';

const { listModels } = vi.hoisted(() => ({ listModels: vi.fn() }));

vi.mock('oci-common', () => ({
	Region: {
		fromRegionId: vi.fn((regionId: string) => {
			const realmDomains: Record<string, string> = {
				'us-phoenix-1': 'oraclecloud.com',
				'us-gov-ashburn-1': 'oraclegovcloud.com',
				'uk-gov-london-1': 'oraclegovcloud.uk',
			};
			const realmDomain = realmDomains[regionId];
			if (!realmDomain) throw new Error('Unknown region');
			return { regionId, realm: { secondLevelDomain: realmDomain } };
		}),
	},
	SimpleAuthenticationDetailsProvider: vi
		.fn()
		.mockImplementation(function MockAuthenticationProvider() {
			return {
				getTenantId: () => 'ocid1.tenancy.oc1..test',
			};
		}),
}));

vi.mock('oci-generativeai', () => ({
	models: { ModelCapability: { Chat: 'CHAT' } },
	GenerativeAiClient: vi.fn().mockImplementation(function MockGenerativeAiClient() {
		return { listModels };
	}),
}));

import {
	getCachedOciGenAiModelCatalogPage,
	getOciGenAiTenancyId,
	type OciGenAiCredentials,
	testOciGenAiConnection,
	validateOciCompartmentId,
	validateOciEndpoint,
	validateOciModelId,
} from './ociGenAi';

const ociCredentials: OciGenAiCredentials = {
	authentication: 'apiKey',
	regionId: 'us-phoenix-1',
	tenancyId: 'ocid1.tenancy.oc1..test',
	userId: 'ocid1.user.oc1..test',
	fingerprint: 'test',
	privateKey: 'test-key',
};

const credential: ICredentialsDecrypted = {
	id: 'credential-id',
	name: 'OCI Generative AI account',
	type: 'ociGenAiApi',
	data: ociCredentials as unknown as ICredentialDataDecryptedObject,
};

const credentialTestContext = {} as ICredentialTestFunctions;

describe('OCI input validation', () => {
	describe('validateOciModelId', () => {
		it('accepts standard named models', () => {
			expect(validateOciModelId('meta.llama-3.3-70b-instruct')).toBe('meta.llama-3.3-70b-instruct');
			expect(validateOciModelId('cohere.command-r-plus')).toBe('cohere.command-r-plus');
		});

		it('accepts OCIDs across realms', () => {
			expect(validateOciModelId('ocid1.generativeaimodel.oc1.iad.amaaaaaa123')).toBe(
				'ocid1.generativeaimodel.oc1.iad.amaaaaaa123',
			);
			expect(validateOciModelId('ocid1.generativeaimodel.oc4.eu-frankfurt-1.amaaaaaa456')).toBe(
				'ocid1.generativeaimodel.oc4.eu-frankfurt-1.amaaaaaa456',
			);
		});

		it('rejects unsafe values', () => {
			expect(() => validateOciModelId('../../etc/passwd')).toThrow();
			expect(() => validateOciModelId('<script>alert(1)</script>')).toThrow();
			expect(() => validateOciModelId('model\nname')).toThrow();
			expect(() => validateOciModelId('')).toThrow();
		});
	});

	describe('validateOciCompartmentId', () => {
		it('accepts compartment and tenancy OCIDs across realms', () => {
			expect(validateOciCompartmentId('ocid1.compartment.oc1..aaaa123')).toBe(
				'ocid1.compartment.oc1..aaaa123',
			);
			expect(validateOciCompartmentId('ocid1.tenancy.oc1..aaaa456')).toBe(
				'ocid1.tenancy.oc1..aaaa456',
			);
			expect(validateOciCompartmentId('ocid1.compartment.oc2..gov123')).toBe(
				'ocid1.compartment.oc2..gov123',
			);
		});

		it('rejects invalid resource types and empty values', () => {
			expect(() => validateOciCompartmentId('ocid1.instance.oc1..aaaa123')).toThrow();
			expect(() => validateOciCompartmentId('   ')).toThrow();
		});
	});

	describe('validateOciEndpoint', () => {
		it('accepts supported OCI inference endpoints', () => {
			expect(
				validateOciEndpoint(
					'https://inference.generativeai.us-phoenix-1.oci.oraclecloud.com',
					'us-phoenix-1',
				),
			).toBe('https://inference.generativeai.us-phoenix-1.oci.oraclecloud.com');
			expect(
				validateOciEndpoint(
					'https://inference.generativeai.us-gov-ashburn-1.oci.oraclegovcloud.com',
					'us-gov-ashburn-1',
				),
			).toBe('https://inference.generativeai.us-gov-ashburn-1.oci.oraclegovcloud.com');
			expect(
				validateOciEndpoint(
					'https://inference.generativeai.uk-gov-london-1.oci.oraclegovcloud.uk',
					'uk-gov-london-1',
				),
			).toBe('https://inference.generativeai.uk-gov-london-1.oci.oraclegovcloud.uk');
		});

		it('rejects untrusted or malformed endpoints', () => {
			expect(() =>
				validateOciEndpoint(
					'http://inference.generativeai.us-phoenix-1.oci.oraclecloud.com',
					'us-phoenix-1',
				),
			).toThrow();
			expect(() => validateOciEndpoint('https://example.com', 'us-phoenix-1')).toThrow();
			expect(() =>
				validateOciEndpoint(
					'https://inference.generativeai.us-phoenix-1.oci.oraclecloud.com.evil.example',
					'us-phoenix-1',
				),
			).toThrow();
			expect(() =>
				validateOciEndpoint(
					'https://user:pass@inference.generativeai.us-phoenix-1.oci.oraclecloud.com',
					'us-phoenix-1',
				),
			).toThrow();
			expect(() =>
				validateOciEndpoint(
					'https://inference.generativeai.us-phoenix-1.oci.oraclecloud.com',
					'us-gov-ashburn-1',
				),
			).toThrow();
		});
	});

	describe('testOciGenAiConnection', () => {
		beforeEach(() => {
			listModels.mockReset();
		});

		it('lists a model in the authenticated tenancy', async () => {
			listModels.mockResolvedValue({ items: [] });
			await expect(getOciGenAiTenancyId(ociCredentials)).resolves.toBe('ocid1.tenancy.oc1..test');

			await expect(testOciGenAiConnection.call(credentialTestContext, credential)).resolves.toEqual(
				{
					status: 'OK',
					message: 'Connection successful',
				},
			);
			expect(listModels).toHaveBeenCalledWith({
				compartmentId: 'ocid1.tenancy.oc1..test',
				limit: 1,
			});
		});

		it('does not expose integration errors', async () => {
			listModels.mockRejectedValue(new Error('private key test-key was rejected'));

			await expect(testOciGenAiConnection.call(credentialTestContext, credential)).resolves.toEqual(
				{
					status: 'Error',
					message: 'Unable to connect. Check your OCI credentials and configuration.',
				},
			);
		});
	});

	describe('getCachedOciGenAiModelCatalogPage', () => {
		beforeEach(() => {
			listModels.mockReset();
		});

		it('reuses the catalog response for subsequent searches', async () => {
			listModels.mockResolvedValue({
				modelCollection: {
					items: [
						{
							id: 'meta.llama-3.3-70b-instruct',
							displayName: 'Meta Llama 3.3 70B Instruct',
						},
					],
				},
				opcNextPage: undefined,
			});

			const request = {
				compartmentId: 'ocid1.compartment.oc1..test',
				capability: ociModels.ModelCapability.Chat,
				vendor: 'meta',
			};
			const firstPage = await getCachedOciGenAiModelCatalogPage(ociCredentials, request);
			await getCachedOciGenAiModelCatalogPage(ociCredentials, request);

			expect(firstPage.searchModels).toEqual([
				{
					id: 'meta.llama-3.3-70b-instruct',
					name: 'Meta Llama 3.3 70B Instruct',
					searchText: 'meta llama 3.3 70b instruct meta.llama-3.3-70b-instruct',
				},
			]);
			expect(listModels).toHaveBeenCalledTimes(1);
		});
	});
});
