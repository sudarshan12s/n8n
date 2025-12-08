import { configureOracleDB } from 'n8n-nodes-base/dist/nodes/Oracle/Sql/transport';
import type { OracleDBNodeCredentials } from 'n8n-nodes-base/nodes/Oracle/Sql/helpers/interfaces';
import type { ILoadOptionsFunctions, INodeListSearchResult } from 'n8n-workflow';

export async function searchModels(
	this: ILoadOptionsFunctions,
	_filter?: string,
): Promise<INodeListSearchResult> {
	const credentials = await this.getCredentials('oracleDBApi');

	const pool = await configureOracleDB.call(this, credentials as OracleDBNodeCredentials);

	const connection = await pool.getConnection();
	const result = await connection.execute(
		'select model_name, algorithm, mining_function from user_mining_models',
	);
	const models = result.rows;
	return {
		results: models.map((model: any) => ({
			name: model[0],
			value: model[0],
		})),
	};
}
