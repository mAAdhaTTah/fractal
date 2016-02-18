'use strict';

const co         = require('co');
const _          = require('lodash');
const Component  = require('./component');
const Collection = require('./collection');
const Source     = require('./source');
const fs         = require('../fs');
const data       = require('../data');
const cli     = require('../cli');

module.exports = function (fileTree, source) {

    const build = co.wrap(function* (dir, parent) {

        let collection;
        const children    = dir.children || [];
        const files       = children.filter(item => item.isFile);
        const directories = children.filter(item => item.isDirectory);
        const matched     = {
            directories: directories,
            files:       files,
            views:       files.filter(f => source.isView(f)),
            varViews:    files.filter(f => source.isVarView(f)),
            configs:     files.filter(f => source.isConfig(f)),
            readmes:     files.filter(f => source.isReadme(f)),
        };

        const dirConfig = yield data.getConfig(_.find(matched.configs, f => f.name.startsWith(dir.name)), {
            name:     dir.name,
            isHidden: dir.isHidden,
            order:    dir.order,
            dir:      dir.path,
            collated: dir.collated
        });
        dirConfig.parent = parent;

        // first figure out if it's a component directory or not...

        const view = _.find(matched.views, { name: dir.name });
        if (view) { // it is a component
            const nameMatch = `${dir.name}.`;
            dirConfig.view = view.base;
            dirConfig.viewName = dir.name;
            dirConfig.viewPath = view.path;
            dirConfig.source = source;
            return Component.create(dirConfig, {
                view:     view,
                readme:   matched.readmes[0],
                varViews: _.filter(matched.varViews, f => f.name.startsWith(nameMatch)),
                other:    _.differenceBy(matched.files, _.flatten([matched.views, matched.varViews, matched.configs, matched.readmes, view]), 'path')
            });
        }

        // not a component, so go through the items and group into components and collections

        if (!parent) {
            collection = source;
            source.setContext(dirConfig.context || {});
            source.setTags(dirConfig.tags || []);
            source._status  = dirConfig.status || source._status;
            source._preview = dirConfig.preview || source._preview;
            source._display = dirConfig.display || source._display;
            source._prefix  = dirConfig.prefix || source._prefix;
        } else {
            collection = new Collection(dirConfig, []);
            collection._source = source;
        }

        const collections = yield matched.directories.map(item => build(item, collection));
        const components  = yield matched.views.map(view => {
            const nameMatch = `${view.name}`;
            const configFile = _.find(matched.configs, f => f.name.startsWith(nameMatch));
            const conf    = data.getConfig(configFile, {
                name:     view.name,
                order:    view.order,
                isHidden: view.isHidden,
                view:     view.base,
                viewName: view.name,
                viewPath: view.path,
                dir:      dir.path,
            });
            return conf.then(c => {
                c.parent = collection;
                c.source = source;
                return Component.create(c, {
                    view: view,
                    readme: null,
                    varViews: matched.varViews.filter(f => f.name.startsWith(nameMatch)),
                    other: []
                });
            });
        });

        collection.setItems(_.orderBy(_.concat(components, collections), ['order', 'name']));
        return collection;
    });

    return build(fileTree);
};
