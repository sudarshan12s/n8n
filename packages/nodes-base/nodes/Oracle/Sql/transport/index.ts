import type {
	IExecuteFunctions,
	ICredentialTestFunctions,
	ILoadOptionsFunctions,
	ITriggerFunctions,
} from 'n8n-workflow';
import oracledb from 'oracledb';

import { ConnectionPoolManager } from '@utils/connection-pool-manager';

import type { OracleDBNodeOptions, OracleDBNodeCredentials } from '../helpers/interfaces';

// used for thick mode to call initOracleClient API only once.
let initializeDriverMode = false;
const failedPools: Set<oracledb.Pool> = new Set();

const getOracleDBConfig = (credentials: OracleDBNodeCredentials) => {
	const { useThickMode, useSSL, ...dbConfig } = {
		...credentials,
		privilege: credentials.privilege || undefined,
	};

	return dbConfig;
};

async function retryCleanup(pool: oracledb.Pool): Promise<void> {
	try {
		await pool.close();
		failedPools.delete(pool);
		//this.logger.debug('Pool closed successfully after retry.', { pool });
	} catch (error) {
		// Log the error and re-add the pool to the failedPools set
		//this.logger.error('Error closing pool, retrying cleanup', { error, retries, pool });

		// Re-add the pool to the failed pools set and schedule the next retry
		if (error.code === 'NJS-104') {
			failedPools.add(pool);
		} else {
			failedPools.delete(pool);
		}
		// Retry after exponential backoff
		//setTimeout(() => retryCleanup(pool, retries + 1), retryDelay);
	}
}

async function retryFailedPools(): Promise<void> {
	if (failedPools.size > 0) {
		for (const failedPool of failedPools) {
			await retryCleanup(failedPool);
		}

		//clear the set (or keep them if max retries aren't reached)
		//failedPools.clear();
	}
}

export async function configureOracleDB(
	this: IExecuteFunctions | ICredentialTestFunctions | ILoadOptionsFunctions | ITriggerFunctions,
	credentials: OracleDBNodeCredentials,
	options: OracleDBNodeOptions = {},
): Promise<oracledb.Pool> {
	const poolManager = ConnectionPoolManager.getInstance(this.logger);
	const fallBackHandler = async (abortController: AbortController): Promise<oracledb.Pool> => {
		const dbConfig = getOracleDBConfig(credentials);

		if (credentials.useThickMode) {
			if (!initializeDriverMode) {
				oracledb.initOracleClient();
				initializeDriverMode = true;
			}
		} else if (initializeDriverMode) {
			// Thick mode is initialized, cannot switch back to thin mode
			throw new Error('Thin mode can not be used after thick mode initialization');
		}
		const pool = await oracledb.createPool(dbConfig);

		abortController.signal.addEventListener('abort', async () => {
			try {
				if (failedPools.size > 0) {
					await retryFailedPools(); // Start with 0 retries
				}
				await pool.close();
				this.logger.debug('pool closed on abort');
			} catch (error) {
				if (error.code === 'NJS-104') {
					failedPools.add(pool); // Keep track of this pool for retry
				}
				this.logger.error('Error closing pool on abort', { error });
			}
		});
		return pool;
	};

	return await poolManager.getConnection<oracledb.Pool>({
		credentials,
		nodeType: 'oracledb',
		nodeVersion: String(options.nodeVersion ?? '1'),
		fallBackHandler,
		wasUsed: (pool) => {
			if (pool) {
				this.logger.debug(`DB pool reused, open connections: ${pool.connectionsOpen}`);
			}
		},
	});
}
