import querystring from 'querystring';
import * as oas3 from 'openapi3-ts';
import {MimeTypeRegistry} from '../utils/mime';
import {contentToMediaTypeRegistry} from './oasUtils';
import MediaType from './MediaType';
import Oas3Context from './Oas3Context';
import Parameter from './Parameter';
import { ParserContext } from './parameterParsers/ParserContext';
import { ParametersMap, ParametersByLocation } from '../types/ApiInterface';
import { ValuesBag, parseParameters } from './parameterParsers';
import { BodyParser } from '../bodyParsers/BodyParser';
import { IValidationError } from '../types/validation';
import { EXEGESIS_CONTROLLER, EXEGESIS_OPERATION_ID } from './extensions';

export default class Operation {
    readonly context: Oas3Context;
    readonly oaOperation: oas3.OperationObject;
    readonly oaPath: oas3.PathItemObject;
    readonly exegesisController: string;
    readonly operationId: string;

    private readonly _requestBodyContentTypes: MimeTypeRegistry<MediaType<BodyParser>>;
    private readonly _parameters: ParametersByLocation<Parameter[]>;

    constructor(
        context: Oas3Context,
        oaOperation: oas3.OperationObject,
        oaPath: oas3.PathItemObject,
        exegesisController: string | undefined,
        parentParameters: Parameter[]
    ) {
        this.context = context;
        this.oaOperation = oaOperation;
        this.oaPath = oaPath;
        this.exegesisController = oaOperation[EXEGESIS_CONTROLLER] || exegesisController;
        this.operationId = oaOperation[EXEGESIS_OPERATION_ID] || oaOperation.operationId;

        const requestBody = oaOperation.requestBody &&
            (context.resolveRef(oaOperation.requestBody) as oas3.RequestBodyObject);

        if(requestBody && requestBody.content) {
            // FIX: This should not be a map of MediaTypes, but a map of request bodies.
            // Request body has a "required" flag, which we are currently ignoring.
            this._requestBodyContentTypes = contentToMediaTypeRegistry<BodyParser>(
                context.childContext(['requestBody', 'content']),
                context.options.bodyParsers,
                'body',
                requestBody.required || false,
                requestBody.content
            );
        } else {
            this._requestBodyContentTypes = new MimeTypeRegistry<MediaType<BodyParser>>();
        }

        const localParameters = (this.oaOperation.parameters || [])
            .map((parameter, index) => new Parameter(context.childContext(['parameters', '' + index]), parameter));
        const allParameters =  parentParameters.concat(localParameters);

        this._parameters = allParameters.reduce(
            (result: ParametersByLocation<Parameter[]>, parameter: Parameter) => {
                (result as any)[parameter.oaParameter.in].push(parameter);
                return result;
            },
            {query: [], header: [], path: [], server: [], cookie: []}
        );
    }

    /**
     * Given a 'content-type' from a request, return a `MediaType` object that
     * matches, or `undefined` if no objects match.
     *
     * @param contentType - The content type from the 'content-type' header on
     *   a request.
     * @returns - The MediaType object to handle this request, or undefined if
     *   no MediaType is set for the given contentType.
     */
    getRequestMediaType(contentType: string) : MediaType<BodyParser> | undefined {
        return this._requestBodyContentTypes.get(contentType);
    }

    parseParameters(params : {
        headers : ValuesBag | undefined,
        rawPathParams: ValuesBag | undefined,
        serverParams: ValuesBag | undefined,
        queryString: string | undefined
    }) : ParametersByLocation<ParametersMap<any>> {
        const {headers, rawPathParams, queryString} = params;
        const ctx = new ParserContext(queryString);

        const parsedQuery = queryString
            ? querystring.parse(queryString, '&', '=', {decodeURIComponent: (val: string) => val})
            : undefined;

        // TODO: Can eek out a little more performance here by precomputing the parsers for each parameter group,
        // since if there are no parameters in a group, we can just do nothing.
        return {
            query: parsedQuery ? parseParameters(this._parameters.query, ctx, parsedQuery) : {},
            header: headers ? parseParameters(this._parameters.header, ctx, headers) : {},
            server: params.serverParams || {},
            path: rawPathParams ? parseParameters(this._parameters.path, ctx, rawPathParams) : {},
            cookie: {}
        };
    }

    validateParameters(parameterValues: ParametersByLocation<ParametersMap<any>>) : IValidationError[] | null {
        const result: IValidationError[] | null = null;
        for(const parameterLocation of Object.keys(parameterValues)) {
            const parameters: Parameter[] = (this._parameters as any)[parameterLocation] as Parameter[];
            const values = (parameterValues as any)[parameterLocation] as ParametersMap<any>;

            for(const parameter of parameters) {
                parameter.validate(values[parameter.oaParameter.name]);
            }
        }

        return result;
    }
}