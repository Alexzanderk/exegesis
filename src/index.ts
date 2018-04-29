import * as http from 'http';
import * as oas3 from 'openapi3-ts';
import pb from 'promise-breaker';
import pump from 'pump';

import { compileOptions } from './options';
import { compile as compileOpenApi } from './oas3';
import generateExegesisRunner from './core/exegesisRunner';
import {
    ExegesisOptions,
    Callback,
    ExegesisRunner,
    HttpResult,
    MiddlewareFunction,
    HttpIncomingMessage
} from './types';

// Export all our public types.
export * from './types';

/**
 * Returns a "runner" function - call `runner(req, res)` to get back a
 * `HttpResult` object.
 *
 * @param openApiDoc - A string, representing a path to the OpenAPI document,
 *   or a JSON object.
 * @param [options] - Options.  See docs/options.md
 * @returns - a Promise<ExegesisRunner>.  ExegesisRunner is a
 *   `function(req, res)` which will handle an API call, and return an
 *   `HttpResult`, or `undefined` if the request could not be handled.
 */
export function compileRunner(
    openApiDoc: string | oas3.OpenAPIObject,
    options?: ExegesisOptions
) : Promise<ExegesisRunner>;

/**
 * Returns a "runner" function - call `runner(req, res)` to get back a
 * `HttpResult` object.
 *
 * @param openApiDoc - A string, representing a path to the OpenAPI document,
 *   or a JSON object.
 * @param options - Options.  See docs/options.md
 * @param done - Callback which retunrs an ExegesisRunner.  ExegesisRunner is a
 *   `function(req, res)` which will handle an API call, and return an
 *   `HttpResult`, or `undefined` if the request could not be handled.
 */
export function compileRunner(
    openApiDoc: string | oas3.OpenAPIObject,
    options: ExegesisOptions | undefined,
    done: Callback<ExegesisRunner>
) : void;

export function compileRunner(
    openApiDoc: string | oas3.OpenAPIObject,
    options?: ExegesisOptions,
    done?: Callback<ExegesisRunner>
) {
    return pb.addCallback(done, async () => {
        const compiledOptions = compileOptions(options);
        const apiInterface = await compileOpenApi(openApiDoc, compiledOptions);
        return generateExegesisRunner(apiInterface);
    });
}

/**
 * Convenience function which writes an `HttpResult` obtained from an
 * ExegesisRunner out to an HTTP response.
 *
 * @param httpResult - Result to write.
 * @param res - The response to write to.
 * @returns - a Promise which resolves on completion.
 */
export function writeHttpResult(httpResult: HttpResult, res: http.ServerResponse) : Promise<void>;

/**
 * Convenience function which writes an `HttpResult` obtained from an
 * ExegesisRunner out to an HTTP response.
 *
 * @param httpResult - Result to write.
 * @param res - The response to write to.
 * @param callback - Callback to call on completetion.
 */
export function writeHttpResult(
    httpResult: HttpResult,
    res: http.ServerResponse,
    done: Callback<void>
) : void;

export function writeHttpResult(
    httpResult: HttpResult,
    res: http.ServerResponse,
    done?: Callback<void>
) {
    return pb.addCallback(done, async () => {
        Object.keys(httpResult.headers).forEach(
            header => res.setHeader(header, httpResult.headers[header])
        );
        res.statusCode = httpResult.status;

        if(httpResult.body) {
            await pb.call((done2 : pump.Callback) => pump(httpResult.body!, res, done2));
        } else {
            res.end();
        }
    });
}

/**
 * Returns a connect/express middleware function which implements the API.
 *
 * @param openApiDoc - A string, representing a path to the OpenAPI document,
 *   or a JSON object.
 * @param [options] - Options.  See docs/options.md
 * @returns - a Promise<MiddlewareFunction>.
 */
export function compileApi(
    openApiDoc: string | oas3.OpenAPIObject,
    options?: ExegesisOptions
) : Promise<MiddlewareFunction>;

/**
 * Returns a connect/express middleware function which implements the API.
 *
 * @param openApiDoc - A string, representing a path to the OpenAPI document,
 *   or a JSON object.
 * @param options - Options.  See docs/options.md
 * @param done - callback which returns the MiddlewareFunction.
 */
export function compileApi(
    openApiDoc: string | oas3.OpenAPIObject,
    options: ExegesisOptions | undefined,
    done: Callback<MiddlewareFunction>
) : void;

export function compileApi(
    openApiDoc: string | oas3.OpenAPIObject,
    options?: ExegesisOptions | undefined,
    done?: Callback<MiddlewareFunction> | undefined
) {
    return pb.addCallback(done, async () => {
        const runner = await compileRunner(openApiDoc, options);

        return function exegesisMiddleware(
            req: HttpIncomingMessage,
            res: http.ServerResponse,
            next: Callback<void>
        ) {
            runner(req, res)
            .then(result => {
                let answer : Promise<void> | undefined;

                if(!result) {
                    if(next) {next();}
                } else if(res.headersSent) {
                    // Someone else has already written a response.  :(
                } else if(result) {
                    answer = writeHttpResult(result, res);
                } else {
                    if(next) {next();}
                }
                return answer;
            })
            .catch(err => {
                if(next) {
                    next(err);
                } else {
                    res.statusCode = err.status || 500;
                    res.end('error');
                }
            });
        };
    });
}
