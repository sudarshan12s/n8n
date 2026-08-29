# OCI Generative AI Chat and Embeddings Nodes

## Purpose

Provide OCI Generative AI chat-model and embeddings integrations for n8n AI workflows, using the pre-release `@oracle/langchain-oci` package until its npm release.

## Scope

| Area | Implementation |
| --- | --- |
| Credentials | `ociGenAiApi` supports API key, instance principal, resource principal, and OCI config-file session authentication. |
| Chat | `LmChatOciGenAi` supplies an OCI LangChain chat model to AI Agent workflows. |
| Embeddings | `EmbeddingsOciGenAi` supplies OCI embeddings to vector-store and RAG workflows. |
| Icons | Both nodes use the shared Oracle SVG icon. |
| Package source | `@oracle/langchain-oci` remains a local tarball reference temporarily; replace it with an npm version when published. |

## Credential and Request Handling

- API-key private keys accept JSON-escaped line breaks and are normalized before being passed to the OCI SDK.
- Model and compartment IDs are validated before they reach OCI.
- The optional inference endpoint must be an HTTPS OCI Generative AI inference hostname in an approved OCI realm. It cannot contain user credentials, ports, paths, query parameters, or fragments.
- A node-level credential test lists one model in the authenticated tenancy. Its failure response is generic so provider errors cannot expose credential material.

## Model Selection

- Chat-model discovery calls OCI's management API with `Chat` capability and optional vendor filters.
- Management model OCIDs are converted to provider model IDs when OCI inference requires a provider ID.
- Retired on-demand models are omitted from the chat selector.
- Embeddings use an explicit region-aware on-demand model catalog because OCI model discovery is not reliable for embedding availability in all regions.
- Chat catalog pages are cached for 60 seconds. Cache entries are isolated by non-secret authentication identity, region, compartment, vendor, capability, and page token. The cache is bounded, shares in-flight requests, and normalizes/sorts models once so typeahead only filters local search text.

## OCI Compatibility

- Tool schemas remove `$schema`, which OCI function declarations do not accept.
- Structured LangChain message content is converted to text before OCI request preparation.
- The chat node subclasses the OCI chat model instead of binding it, preserving chat-model capabilities such as tool binding for downstream n8n agents.

## Implementation TODO

- [x] Add OCI credentials, chat node, embeddings node, and Oracle icons.
- [x] Add shared OCI client, validation, model catalog, and credential-test utilities.
- [x] Add OCI request compatibility handling for tools and structured messages.
- [x] Add input-validation, endpoint-validation, credential-test, and catalog-cache unit coverage.
- [ ] Replace the local `@oracle/langchain-oci` tarball with its published npm package.

## Verification

Run from `packages/@n8n/nodes-langchain`:

```bash
pnpm test utils/ociGenAi.test.ts
pnpm typecheck
pnpm lint
```
