const express = require('express')
const https = require('https')
const http = require('http')
const fetch = require('axios')

const settings = require('./settings')
const app = express()

// x-response-time

app.use((req, res, next) => {
  const start = Date.now();
  next();
  const ms = Date.now() - start;
  console.log(`[${ms}ms] ${req.method} ${req.url}`);
})

// lowercase query string parameters

app.use((req, res, next) => {
  for (var key in req.query) {
    req.query[key.toLowerCase()] = req.query[key];
  }
  next();
})

// router

const DisabledRequestHeaders = [
  'accept',
  'accept-encoding',
  'connection',
  'cookie',
  'host',
  'upgrade-insecure-requests',
]

const EnabledResponseHeaders = [
  'cache-control',
  'content-security-policy',
  'date',
  'server',
  'strict-transport-security',
  'etag',
  'link',
  'retry-after',
  'x-poll-interval',
  'x-gitHub-media-type',
  'x-gitHub-request-id',
  'x-frame-options',
  'x-xss-protection',
];

function getUsableHeaders(headers) {
  return Object.keys(headers)
    .filter(h => !DisabledRequestHeaders.includes(h))
    .reduce((acc, h) => ({
      [h]: headers[h],
      ...acc,
    }), {})
}

function getResponseHeaders(headers) {
  return Object.keys(headers)
    .filter(h => EnabledResponseHeaders.includes(h))
    .reduce((acc, h) => ({
      [h]: headers[h],
      ...acc,
    }), {})
}

function tryParseBase64(value) {
  if (!value) return false
  try {
    new Buffer(value, 'base64')
    return true
  }
  catch (e) {
    return false
  }
}

function fetchGithubGraphQL(authToken, headers, repositoryQuery) {
  const graphQlQuery = `
query {
  repository(owner: "${settings.owner}", name: "${settings.repository}") {
    ${repositoryQuery}
  }
  rateLimit {
    limit
    cost
    remaining
    resetAt
  }
}`
  const body = JSON.stringify({
    query: graphQlQuery
  })
  const request = {
    method: 'POST',
    url: 'https://api.github.com/graphql',
    data: body,
    headers: {
      'Authorization': `bearer ${authToken}`,
      ...getUsableHeaders(headers)
    }
  }
  return fetch(request)
    .then(response => ({
      responseData: response.data,
      responseHeaders: getResponseHeaders(response),
      responseStatus: response.status,
      responseStatusText: response.statusText,
    }))
}

const github = {
  getPageComments: (req, res) => {
    if (req.path.indexOf('favicon') > -1) {
      res.status(404).end()
      return;
    }
    const number = Math.floor(Number(req.query.number))
    if (!(number > 0)) {
      throw new Error("'number' is required integer query string parameter")
    }

    const afterKey = req.query.after
    const afterKeyFilter = afterKey ? `, after: ${afterKey}` : ''
    if (afterKey && !tryParseBase64(afterKey)) {
      throw new Error("'after' query string parameter must be base64-encoded string")
    }

    const pageCommentsQuery = `
issue(number: ${number}) {
  url
  comments(first:100${afterKeyFilter}) {
    totalCount
    pageInfo {
      startCursor
      endCursor
      hasNextPage
    }
    nodes {
      bodyHTML
      createdAt
      author {
        login
        avatarUrl
        url
      }
    }
  }
}`
    return fetchGithubGraphQL(settings.authToken, req.headers, pageCommentsQuery)
      .then(({responseData, responseHeaders}) => {
        res.set(responseHeaders)
        res.send(responseData)
      })
  },

  getListPageCommentsCountStats: (req, res) => {
    if (req.path.indexOf('favicon') > -1) {
      res.status(404).end()
      return;
    }
    const pageSize = Number(req.query.pagesize) || 20
    const afterKey = req.query.after
    if (afterKey && !tryParseBase64(afterKey)) {
      throw new Error("'after' query string parameter must be base64-encoded string")
    }
    const afterKeyFilter = afterKey ? `, after: "${afterKey}"` : ''
    const pageCommentsQuery = `
issues(first: ${pageSize}, orderBy:{direction:DESC, field:CREATED_AT}${afterKeyFilter}) {
  totalCount
  pageInfo {
    startCursor
    endCursor
    hasNextPage
  }
  nodes {
    number
    title
    comments {
      totalCount
    }
  }
}
`
    return fetchGithubGraphQL(settings.authToken, req.headers, pageCommentsQuery)
      .then(({responseData, responseHeaders}) => {
        res.set(responseHeaders)
        res.send(responseData)
      })
  },
}

app.get('/page-comments/:number', github.getPageComments)

app.get('/list-page-comments-count', github.getListPageCommentsCountStats)

if (settings['use-http-port-80']) {
  http.createServer(app).listen(80, () => console.log(`Application started, listening on port 80`));
}

const portNumber = settings['listener-port']
if (settings['use-listener-port'] && portNumber) {
  app.listen(portNumber, () => console.log(`Application started, listening on port ${portNumber}`))
}

const processEnvPortNumber = process.env.PORT
if (processEnvPortNumber) {
  app.listen(processEnvPortNumber, () => console.log(`Application started, listening on port ${processEnvPortNumber}`))
}