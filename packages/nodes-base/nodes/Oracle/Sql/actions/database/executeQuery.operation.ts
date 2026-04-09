import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	IPairedItemData,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type oracledb from 'oracledb';

import { getResolvables, updateDisplayOptions } from '@utils/utilities';

import type {
	ExecuteOpBindParam,
	OracleDBNodeOptions,
	QueriesRunner,
	QueryWithValues,
} from '../../helpers/interfaces';
import { getBindParameters } from '../../helpers/utils';
import { optionsCollection } from '../common.descriptions';

const properties: INodeProperties[] = [
	{
		displayName: 'Statement',
		name: 'query',
		type: 'string',
		default: '',
		placeholder: 'e.g. SELECT id, name FROM product WHERE quantity > :1 AND price <= :2',
		noDataExpression: true,
		required: true,
		description:
			"The SQL statement to execute. You can use n8n expressions and positional parameters like :1, :2, :3, or named parameters like :name, :ID, etc to refer to the 'Bind Variable Placeholder Values' set in options below.",
		typeOptions: {
			editor: 'sqlEditor',
			sqlDialect: 'OracleDB',
		},
		hint: 'Consider using bind parameters to prevent SQL injection attacks. Add them in the options below',
	},
	...optionsCollection,
];

const displayOptions = {
	show: {
		resource: ['database'],
		operation: ['execute'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

/**
 * Query execution function for this node.
 *
 * This method is called once for every execution of the node during a workflow run.
 * It receives input data from the previous node(s) and returns output data to the next node(s).
 *
 *
 * Returns:
 * - An array of `INodeExecutionData` objects containing JSON data and optionally binary data, PairedItem,...
 */
export async function execute(
	this: IExecuteFunctions,
	runQueries: QueriesRunner,
	items: INodeExecutionData[],
	nodeOptions: OracleDBNodeOptions,
	_pool?: oracledb.Pool,
): Promise<INodeExecutionData[]> {
	const queries: QueryWithValues[] = [];
	const node = this.getNode();
	const shouldContinueOnFail = this.continueOnFail() || node.onError === 'continueErrorOutput';

	for (let index = 0; index < items.length; index++) {
		let query = this.getNodeParameter('query', index) as string;

		// Dynamically replaces placeholders ({{...}}) in SQL queries.
		// Ex: SELECT * FROM users WHERE name = '{{ $json["name"] }}'
		// to SELECT * FROM users WHERE name = 'Alice'
		for (const resolvable of getResolvables(query)) {
			query = query.replace(resolvable, this.evaluateExpression(resolvable, index) as string);
		}

		let values: any = [];

		// get list of param objects entered by user
		const parameterIDataObjectList =
			((this.getNodeParameter('options.params', index, {}) as IDataObject)
				.values as ExecuteOpBindParam[]) || [];
		if (parameterIDataObjectList.length) {
			const { updatedQuery, bindParameters } = getBindParameters(query, parameterIDataObjectList);
			query = updatedQuery;
			values = bindParameters;
		}

		queries.push({ query, values });
	}

	const rawResult = await runQueries(queries, items, nodeOptions);
	const result = Array.isArray(rawResult) ? rawResult : [];

	const oracleSignature = /(NJS-\d{3}|ORA-\d{5})/i;

	const extractOracleErrorInfo = (
		data: IDataObject,
	): { message: string; error: IDataObject } | null => {
		const errorField = data.error;
		const messageField = typeof data.message === 'string' ? data.message : undefined;

		let errorMessage: string | undefined;
		let errorNum: number | undefined;

		if (typeof errorField === 'string') {
			errorMessage = errorField;
		} else if (typeof errorField === 'object' && errorField !== null) {
			const errorObject = errorField as IDataObject;
			if (typeof errorObject.message === 'string') {
				errorMessage = errorObject.message;
			}
			if (typeof errorObject.errorNum === 'number') {
				errorNum = errorObject.errorNum;
			}
		}

		const message = messageField ?? errorMessage;
		const hasOracleSignature =
			(typeof message === 'string' && oracleSignature.test(message)) ||
			typeof errorNum === 'number';

		if (!hasOracleSignature) return null;

		const normalizedMessage =
			typeof message === 'string' && message.trim().length > 0 ? message : 'Oracle query failed';

		const errorPayload: IDataObject =
			typeof errorField === 'object' &&
			errorField !== null &&
			Object.keys(errorField as IDataObject).length
				? { ...(errorField as IDataObject) }
				: typeof errorField === 'string'
					? { message: errorField }
					: { message: normalizedMessage };

		if (typeof errorNum === 'number' && errorPayload.errorNum === undefined) {
			errorPayload.errorNum = errorNum;
		}

		return { message: normalizedMessage, error: errorPayload };
	};

	const failingEntries = new Map<INodeExecutionData, { message: string; error: IDataObject }>();

	for (const item of result) {
		const data = item?.json as IDataObject | undefined;
		if (!data) continue;

		const info =
			extractOracleErrorInfo(data) ||
			(typeof data.message === 'string' && oracleSignature.test(data.message)
				? {
						message: data.message,
						error: { message: data.message },
					}
				: null);

		if (info) {
			failingEntries.set(item, info);
		}
	}

	if (!shouldContinueOnFail && failingEntries.size > 0) {
		const [failingItem, info] = failingEntries.entries().next().value as [
			INodeExecutionData,
			{ message: string; error: IDataObject },
		];

		const pairedItemData = failingItem.pairedItem;
		let itemIndex = 0;

		if (Array.isArray(pairedItemData)) {
			itemIndex = pairedItemData[0]?.item ?? 0;
		} else if (typeof pairedItemData === 'number') {
			itemIndex = pairedItemData;
		} else {
			itemIndex = (pairedItemData as IPairedItemData | undefined)?.item ?? 0;
		}

		throw new NodeOperationError(node, info.message || 'Oracle query failed', {
			itemIndex,
		});
	}

	if (shouldContinueOnFail && failingEntries.size > 0) {
		return result.map((item) => {
			const info = failingEntries.get(item);
			if (!info) return item;

			return {
				...item,
				json: {
					error: info.error,
					message: info.message,
				},
			};
		});
	}

	return rawResult ?? result;
}
