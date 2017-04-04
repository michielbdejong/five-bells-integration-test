# five-bells-integration-test

> A module to help with testing Five Bells components against each other

## Introduction

This module is used by the CI tests of the different Five Bells components. This module is installed with each component as a dev dependency and run during continuous integration. When run, it installs the other components and then tests them against the local working tree of the current component.

## Installation

```sh
npm install --save-dev five-bells-integration-test
```

## Usage (with Docker)
Get the Docker image for the Five Bells integration tests,
and save yourself a lot of configuration and slow building steps on
your laptop:
```sh
docker pull michielbdejong/five-bells-integration-test
```

That pulls in a certified build from Docker's hub, but if you like to
build the Docker imager yourself then just do `docker build .` instead.

But of course that's not what you want,
You are probably not so interested in seeing the integration tests run
on the master branches of the various repos as they were when this
Docker image was built, because you can already watch that on circleci,
but just so you know, the command for that would be:
```sh
docker run michielbdejong/five-bells-integration-test
```

So instead, go inside the container and run the tests interactively:
```sh
docker run -it --rm michielbdejong/five-bells-integration-test /bin/bash
$ cd integration-test/ilp-kit ; git status ; git fetch origin ; git checkout origin/my-awesome-improvement-that-I-want-to-test ; cd ../..
$ vim src/tests/index.js # add some debug statement to that failing `beforeEach` hook
$ vim integration-test/node_modules/ilp-connector/src/lib/route-builder.js +123 # add a console.log statement to see how that error is caused
$ git branch mj-currency_scale && git checkout mj-currency_scale # make the integration test loader know you want to test that cross-repo branch instead of master
$ ./src/bin/integration test advanced connector_first # run only the 'advanced' and 'connector_first' integration test
$ ./src/bin/integration test # run all the integration tests
```

## Usage (without Docker)

In any five-bells module which has `five-bells-integration-test` installed, simply run:

``` sh
npm run integration
```

This is enabled by the following config in the `package.json`:

``` json
{
  "scripts": {
    "integration": "integration test"
  }
}
```

## Tests

The five-bells-integration-test module can be tested on its own:

```sh
npm install
npm test
```
