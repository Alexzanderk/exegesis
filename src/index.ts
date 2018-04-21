import $RefParser from 'json-schema-ref-parser';
import OpenApi from './oas3';
import { compileOptions } from './options';
import { ExegesisOptions, oas3 } from './types';

export * from './types';

/**
 * Reads an OpenAPI document from a YAML or JSON file.
 *
 * @param openApiDocFile - The file containing the OpenAPI document.
 * @returns {Promise<OpenApi>} - Returns the parsed OpenAPI document.
 */
// TODO: Support promise or callback.
export function compile(openApiDocFile: string, options?: ExegesisOptions): Promise<OpenApi> {
    const refParser = new $RefParser();

    return refParser.dereference(openApiDocFile, {dereference: {circular: false}})
    .then((openApiDoc: any) => {
        return new OpenApi(openApiDoc as oas3.OpenAPIObject, compileOptions(options));
    });
}
