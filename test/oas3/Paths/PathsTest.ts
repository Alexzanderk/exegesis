import 'mocha';
import {expect} from 'chai';

import Paths from '../../../src/oas3/Paths';
import Oas3Context from '../../../src/oas3/Oas3Context';
import { defaultCompiledOptions, makeOpenApiDoc } from '../../fixtures';

const DUMMY_PATH_OBJECT = {
    get: {
        responses: {
            200: {
                description: 'OK!'
            }
        }
    }
};

describe('oas3 Paths', function() {
    it('should resolve paths', function() {
        const openApiDoc = makeOpenApiDoc();
        openApiDoc.paths['/foo'] = DUMMY_PATH_OBJECT;
        const paths = new Paths(new Oas3Context(openApiDoc, ['paths'], defaultCompiledOptions));
        const resolved = paths.resolvePath('/foo');
        expect(resolved).to.exist;
        expect(resolved!.path.oaPath).to.eql(DUMMY_PATH_OBJECT);
        expect(resolved!.rawPathParams).to.eql(undefined);
    });

    it('should resolve a path with parameters', function() {
        const openApiDoc = makeOpenApiDoc();
        openApiDoc.paths['/{var}/foo'] = Object.assign({
            parameters: [{
                name: 'var',
                in: 'path',
                required: true,
                schema: {type: 'string'}
            }]
        }, DUMMY_PATH_OBJECT);

        const paths = new Paths(new Oas3Context(openApiDoc, ['paths'], defaultCompiledOptions));
        const resolved = paths.resolvePath('/bar/foo');
        expect(resolved).to.exist;
        expect(resolved!.rawPathParams).to.eql({var: 'bar'});
    });

    it('should not treat specitifcation extensions as paths', function() {
        const openApiDoc = makeOpenApiDoc();
        openApiDoc.paths['x-my-extension'] = DUMMY_PATH_OBJECT;
        const paths = new Paths(new Oas3Context(openApiDoc, ['paths'], defaultCompiledOptions));
        const resolved = paths.resolvePath('x-my-extension');
        expect(resolved).to.not.exist;
    });

    it('error on paths that do not start with /', function() {
        const openApiDoc = makeOpenApiDoc();
        openApiDoc.paths['foo'] = DUMMY_PATH_OBJECT;
        expect(() =>
            new Paths(new Oas3Context(openApiDoc, ['paths'], defaultCompiledOptions))
        ).to.throw('Invalid path "foo"');
    });

    it('should allow empty paths object', function() {
        const openApiDoc = makeOpenApiDoc();
        expect(() =>
            new Paths(new Oas3Context(openApiDoc, ['paths'], defaultCompiledOptions))
        ).to.not.throw;
    });
});