import pb from 'promise-breaker';
import * as oas3 from 'openapi3-ts';

import { MimeTypeRegistry } from '../utils/mime';
import { contentToRequestMediaTypeRegistry } from './oasUtils';
import RequestMediaType from './RequestMediaType';
import Oas3CompileContext from './Oas3CompileContext';
import Parameter from './Parameter';
import { RawValues, parseParameterGroup, parseQueryParameters } from './parameterParsers';
import {
    ParametersMap,
    ParametersByLocation,
    IValidationError,
    ExegesisContext,
    ExegesisAuthenticated,
    Dictionary
} from '../types';
import { EXEGESIS_CONTROLLER, EXEGESIS_OPERATION_ID, EXEGESIS_ROLES } from './extensions';
import { HttpError } from './../errors';

const METHODS_WITH_BODY = ['post', 'put'];

// Returns a `{securityRequirements, requiredRoles}` object for the given operation.
function getSecurityRequirements(
    context: Oas3CompileContext, // Operation context.
    oaOperation: oas3.OperationObject
) {
    const securityRequirements = (oaOperation.security || context.openApiDoc.security || []);
    let requiredRoles = oaOperation[EXEGESIS_ROLES] || context.openApiDoc[EXEGESIS_ROLES] || [];

    if(requiredRoles && requiredRoles.length > 0 && (securityRequirements.length === 0)) {
        if(oaOperation.security && !oaOperation[EXEGESIS_ROLES]) {
            // Operation explicitly sets security to `{}`, but doesn't set
            // `x-exegesis-roles`.  This is OK - we'll ingore roles for this
            // case.
            requiredRoles = [];
        } else {
            throw new Error(`Operation ${context.jsonPointer} has no security requirements, but requires roles: ` +
                requiredRoles.join(','));
        }
    }

    if(typeof requiredRoles === 'string') {
        requiredRoles = [requiredRoles];
    } else if(!Array.isArray(requiredRoles)) {
        const rolesPath = oaOperation[EXEGESIS_ROLES]
            ? context.jsonPointer + `/${EXEGESIS_ROLES}`
            : `/${EXEGESIS_ROLES}`;
        throw new Error(`${rolesPath} must be an array of strings.`);
    }

    return {securityRequirements, requiredRoles};
}

function getMissing(required: string[], have: string[] | undefined) {
    if(!have || have.length === 0) {
        return required;
    } else {
        return required.filter(r => !have.includes(r));
    }
}

function validateController(
    context: Oas3CompileContext,
    controller: string | undefined,
    operationId: string | undefined
) {
    if(!controller && !context.options.allowMissingControllers) {
        throw new Error(`Missing ${EXEGESIS_CONTROLLER} for ${context.jsonPointer}`);
    }
    if(!operationId && !context.options.allowMissingControllers) {
        throw new Error(`Missing operationId or ${EXEGESIS_OPERATION_ID} for ${context.jsonPointer}`);
    }
    if(controller && operationId) {
        if(!context.options.controllers[controller]) {
            throw new Error(`Could not find controller ${controller} defined in ${context.jsonPointer}`);
        } else if(!context.options.controllers[controller][operationId]) {
            throw new Error(`Could not find operation ${controller}#${operationId} defined in ${context.jsonPointer}`);
        }
    }
}

/*
 * Validate that all operations/request bodies have a controller and
 * operationId defined.
 */
function validateControllers(
    context: Oas3CompileContext,
    requestBody: oas3.RequestBodyObject | undefined,
    opController: string | undefined,
    operationId: string | undefined
) {
    if(requestBody) {
        for(const mediaType of Object.keys(requestBody.content)) {
            const mediaContext = context.childContext(['requestBody', 'content', mediaType]);
            const mediaTypeObject = requestBody.content[mediaType];
            const mediaController = mediaTypeObject[EXEGESIS_CONTROLLER] || opController;
            const mediaOperationId = mediaTypeObject[EXEGESIS_OPERATION_ID] || operationId;
            validateController(mediaContext, mediaController, mediaOperationId);
        }
    } else {
        validateController(context, opController, operationId);
    }
}

export default class Operation {
    readonly context: Oas3CompileContext;
    readonly oaOperation: oas3.OperationObject;
    readonly oaPath: oas3.PathItemObject;
    readonly exegesisController: string | undefined;
    readonly operationId: string | undefined;
    readonly securityRequirements: oas3.SecurityRequirementObject[];

    /**
     * A list of roles a user must have to call this operation.
     */
    readonly requiredRoles: string[];

    /**
     * If this operation has a `requestBody`, this is a list of content-types
     * the operation understands.  If this operation does not expect a request
     * body, then this is undefined.  Note this list may contain wildcards.
     */
    readonly validRequestContentTypes: string[] | undefined;

    private readonly _requestBodyContentTypes: MimeTypeRegistry<RequestMediaType>;
    private readonly _parameters: ParametersByLocation<Parameter[]>;

    constructor(
        context: Oas3CompileContext,
        oaOperation: oas3.OperationObject,
        oaPath: oas3.PathItemObject,
        method: string,
        exegesisController: string | undefined,
        parentParameters: Parameter[]
    ) {
        this.context = context;
        this.oaOperation = oaOperation;
        this.oaPath = oaPath;
        this.exegesisController = oaOperation[EXEGESIS_CONTROLLER] || exegesisController;
        this.operationId = oaOperation[EXEGESIS_OPERATION_ID] || oaOperation.operationId;

        const security = getSecurityRequirements(context, oaOperation);
        this.securityRequirements = security.securityRequirements;
        this.requiredRoles = security.requiredRoles;

        for(const securityRequirement of this.securityRequirements) {
            for(const schemeName of Object.keys(securityRequirement)) {
                if(!context.options.authenticators[schemeName]) {
                    throw new Error(`Operation ${context.jsonPointer} references security scheme "${schemeName}" ` +
                        `but no authenticator was provided.`);
                }
            }
        }

        const requestBody = oaOperation.requestBody && METHODS_WITH_BODY.includes(method)
            ? (context.resolveRef(oaOperation.requestBody) as oas3.RequestBodyObject)
            : undefined;

        validateControllers(
            context,
            requestBody,
            this.exegesisController,
            this.operationId
        );

        if(requestBody) {
            this.validRequestContentTypes = Object.keys(requestBody.content);

            const contentContext = context.childContext(['requestBody', 'content']);
            // FIX: This should not be a map of MediaTypes, but a map of request bodies.
            // Request body has a "required" flag, which we are currently ignoring.
            this._requestBodyContentTypes = contentToRequestMediaTypeRegistry(
                contentContext,
                {in: 'request', name: 'body', docPath: contentContext.path},
                requestBody.required || false,
                requestBody.content
            );
        } else {
            this._requestBodyContentTypes = new MimeTypeRegistry<RequestMediaType>();
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
    getRequestMediaType(contentType: string) : RequestMediaType | undefined {
        return this._requestBodyContentTypes.get(contentType);
    }

    /**
     * Parse parameters for this operation.
     * @param params - Raw headers, raw path params and server params from
     *   `PathResolver`, and the raw queryString.
     * @returns parsed parameters.
     */
    parseParameters(params : {
        headers : RawValues | undefined,
        rawPathParams: RawValues | undefined,
        serverParams: RawValues | undefined,
        queryString: string | undefined
    }) : ParametersByLocation<ParametersMap<any>> {
        const {headers, rawPathParams, queryString} = params;

        return {
            query: parseQueryParameters(this._parameters.query, queryString),
            header: parseParameterGroup(this._parameters.header, headers || {}),
            server: params.serverParams || {},
            path: rawPathParams ? parseParameterGroup(this._parameters.path, rawPathParams) : {},
            cookie: {}
        };
    }

    validateParameters(parameterValues: ParametersByLocation<ParametersMap<any>>) : IValidationError[] | null {
        // TODO: We could probably make this a lot more efficient by building the schema
        // for the parameter tree.
        let errors: IValidationError[] | null = null;
        for(const parameterLocation of Object.keys(parameterValues)) {
            const parameters: Parameter[] = (this._parameters as any)[parameterLocation] as Parameter[];
            const values = (parameterValues as any)[parameterLocation] as ParametersMap<any>;

            for(const parameter of parameters) {
                const innerResult = parameter.validate(values[parameter.oaParameter.name]);
                if(innerResult && innerResult.errors && innerResult.errors.length > 0) {
                    errors = errors || [];
                    errors = errors.concat(innerResult.errors);
                } else {
                    values[parameter.oaParameter.name] = innerResult.value;
                }
            }
        }

        return errors;
    }

    /**
     * Checks a single security requirement from an OAS3 `security` field.
     *
     * @param triedSchemes - A cache where keys are names of security schemes
     *   we've already tried, and values are the results returned by the
     *   authenticator.
     * @param errors - An array of strings - we can push any errors we encounter
     *   to this list.
     * @param securityRequirement - The security requirement to check.
     * @param exegesisContext - The context for the request to check.
     * @returns - If the security requirement matches, this returns an object
     *   where keys are security schemes and the values are the results from
     *   the authenticator.  If the requirements are not met, returns undefined
     *   (and adds some errors to `errors`).
     */
    private async _checkSecurityRequirement(
        triedSchemes : Dictionary<ExegesisAuthenticated | null>,
        errors: string[],
        securityRequirement: oas3.SecurityRequirementObject,
        exegesisContext: ExegesisContext
    ) {
        const requiredSchemes = Object.keys(securityRequirement);

        const result : Dictionary<any> = Object.create(null);
        let failed = false;

        for(const scheme of requiredSchemes) {
            if(exegesisContext.isResponseFinished()) {
                // Some authenticator has written a response.  We're done.  :(
                failed = true;
                break;
            }

            if(!(scheme in triedSchemes)) {
                const authenticator = this.context.options.authenticators[scheme];
                triedSchemes[scheme] = await pb.call(authenticator, null, exegesisContext);
            }
            const authenticated = triedSchemes[scheme];

            if(!authenticated) {
                // Couldn't authenticate.  Try the next one.
                failed = true;
                break;
            }

            const missingScopes = getMissing(securityRequirement[scheme], authenticated.scopes);
            if(missingScopes.length > 0) {
                failed = true;
                errors.push(`Authenticated using '${scheme}' but missing required ` +
                    `scopes: ${missingScopes.join(', ')}.`);
                break;
            }

            const missingRoles = getMissing(this.requiredRoles, authenticated.roles);
            if(missingRoles.length > 0) {
                failed = true;
                errors.push(`Authenticated using '${scheme}' but missing required ` +
                  `roles: ${missingRoles.join(', ')}.`);
                break;
            }

            result[scheme] = authenticated;
        }

        if(failed) {
            return undefined;
        } else {
            return result;
        }
    }

    async authenticate(
        exegesisContext: ExegesisContext
    ) : Promise<{[scheme: string]: ExegesisAuthenticated} | undefined> {
        if(this.securityRequirements.length === 0) {
            // No auth required
            return undefined;
        }

        const errors: string[] = [];
        let result : Dictionary<ExegesisAuthenticated> | undefined;

        const triedSchemes : Dictionary<ExegesisAuthenticated> = Object.create(null);

        for(const securityRequirement of this.securityRequirements) {
            result = await this._checkSecurityRequirement(
                triedSchemes,
                errors,
                securityRequirement,
                exegesisContext
            );

            if(result || exegesisContext.isResponseFinished()) {
                // We're done!
                break;
            }
        }

        if(result) {
            // Successs!
            return result;
        } else if(errors.length > 0) {
            throw new HttpError(403, errors.join('\n'));
        } else {
            const authSchemes = this.securityRequirements
                .map(requirement => {
                    const schemes = Object.keys(requirement);
                    return schemes.length === 1 ? schemes[0] : `(${schemes.join(' + ')})`;
                })
                .join(', ');

            // TODO: Could return 401 here if the missing auth scheme or schemes are all basic auth.
            throw new HttpError(403, `Must authenticate using one of the following schemes: ${authSchemes}.`);
        }
    }
}