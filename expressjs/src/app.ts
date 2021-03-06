import express from 'express'
import httpContext from 'express-http-context'
import process from 'process'
import uuid from 'uuid'
import winstonLoggly from 'winston-loggly-bulk'

import github from './github-api'
import settings from '../settings.json'
import logger from './logger'
import {
  IIndexPageCommentsResult,
  IIssueCommentsResult,
  IOAuthTokenResult,
} from './app-types'

const app = express()

let Sentry = null
if (settings.sentry && settings.sentry.enabled) {
  Sentry = require('@sentry/node')
  Sentry.init({ dsn: settings.sentry.dsn })
  app.use(Sentry.Handlers.requestHandler())
}

const accessTokenCookieName = 'github-comments-access-token'

app.use(httpContext.middleware)
app.use(function(req, res, next) {
  const requestId = req.get(logger.requestIdHeaderName) || uuid.v4()
  httpContext.set(logger.requestIdHeaderName, requestId)
  res.set(logger.requestIdHeaderName, requestId)
  next()
})

// x-response-time

app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', function() {
    const ms = Date.now() - start
    logger.info('Request completed', {
      requestId: res.get(logger.requestIdHeaderName),
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      statusText: res.statusMessage,
      duration: ms,
      hostname: req.get('host'),
      remote: req.ip,
      protocol: req.protocol,
      useragent: req.get('user-agent'),
      referer: req.get('Referrer'),
      route: req.route && req.route.path,
      routeParams: req.params,
    })
  })
  next()
})

// enable CORS

app.use((req, res: express.Response, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
  next()
})

// enable body parsing

app.use(express.json())

// lowercase query string parameters

app.use((req, res, next) => {
  for (const key in req.query) {
    req.query[key.toLowerCase()] = req.query[key]
  }
  next()
})

// router

app.get('/oauth/login', (req: express.Request, res: express.Response) => {
  if (!req.query.code) {
    res.status(404).send({ error: 'code query parameter is required' })
    return
  }
  return github
    .getOAuthAccessToken(req.query.code)
    .then(oauthResponseData => github
      .getCurrentAuthenticatedUserInfo(oauthResponseData.accessToken)
      .then(userResponse => {
        const result: IOAuthTokenResult = {
          ...userResponse,
          ...oauthResponseData,
        }
        res.cookie(accessTokenCookieName, oauthResponseData.accessToken)
        res.status(200).send(result)
      })
    )
    .catch(err => {
      const result = (err.response && err.response.data) || { message: 'Unexpected error' }
      res.status(400).send(result)
    })
})

app.get('/oauth/logout', (req: express.Request, res: express.Response) => {
  const accessToken = (req.cookies && req.cookies[accessTokenCookieName])
    || (req.headers.authorization && req.headers.authorization.replace(/^bearer/i, '').trim())
    || (req.query && req.query.accessToken)
  if (!accessToken) {
    res.sendStatus(404)
    return
  }
  logger.info('OAuth: logout', {
    token: accessToken,
  })
  res.clearCookie(accessTokenCookieName, { domain: settings.domain })
  res.sendStatus(200)
})

// supported query parameters:
// - after
app.get('/page-comments/:number', (req: express.Request, res: express.Response) => github
  .getPageComments({
    headers: req.headers,
    query: req.query,
    number: req.params.number,
    accessToken: req.cookies && req.cookies[accessTokenCookieName],
  })
  .then(({ responseData, responseHeaders, responseStatus }) => {
    const result: IIssueCommentsResult = {
      rateLimit: responseData.data.rateLimit,
      errors: responseData.errors,
      issue: {
        id: responseData.data.repository.issue.id,
        number: responseData.data.repository.issue.number,
        url: responseData.data.repository.issue.url,
        commentsTotalCount: responseData.data.repository.issue.comments.totalCount,
        commentsCursor: responseData.data.repository.issue.comments.pageInfo,
        comments: responseData.data.repository.issue.comments.nodes.map(n => ({
          id: n.id,
          url: n.url,
          body: n.bodyHTML,
          createdAt: n.createdAt,
          userLogin: n.author && n.author.login,
          userUrl: n.author && n.author.url,
          userAvatar: n.author && n.author.avatarUrl,
        })),
      },
    }
    res.set(responseHeaders)
    res.status(responseStatus).send(result)
  }, err => res.status(400).send(err.responseData)))

app.post('/page-comments/:number', (req: express.Request, res: express.Response) => {
  const accessToken = (req.cookies && req.cookies[accessTokenCookieName])
    || (req.query && req.query.accessToken)
  const { body } = req
  if (!accessToken || !body) {
    res.sendStatus(400)
    return
  }
  return github
    .postPageComment({ accessToken, body, number: req.params.number })
    .then(
      data => res.status(201).send(data),
      err => res.status(err.status).send(err.errors))
})

app.post('/index-page-comments-count', (req: express.Request, res: express.Response) => github
  .getListPageCommentsCountStats({
    headers: req.headers,
    body: req.body,
    accessToken: req.cookies && req.cookies[accessTokenCookieName],
  })
  .then(({ responseData, responseHeaders }) => {
    const result: IIndexPageCommentsResult = {
      rateLimit: responseData.data.rateLimit,
      errors: responseData.errors,
      issues: Object
        .getOwnPropertyNames(responseData.data.repository)
        .map(n => {
          const issue = responseData.data.repository[n]
          return {
            id: issue.id,
            number: issue.number,
            url: issue.url,
            commentsTotalCount: issue.comments.totalCount,
          }
        }),
    }
    res.set(responseHeaders)
    res.status(200).send(result)
  }, err => res.status(400).send(err.responseData))
)

if (Sentry) {
  app.use(Sentry.Handlers.errorHandler())
}

if (settings['use-http-port-80']) {
  app.listen(80, () => logger.info('Application started', { port: 80 }))
}

const portNumber = settings['listener-port']
if (settings['use-listener-port'] && portNumber) {
  app.listen(portNumber, () => logger.info('Application started', { port: portNumber }))
}

const processEnvPortNumber = process.env.PORT
if (processEnvPortNumber) {
  app.listen(processEnvPortNumber, () => logger.info('Application started', { port: processEnvPortNumber }))
}

process.on('exit', code => {
  logger.info('Process exit', { code: code })
  winstonLoggly.flushLogsAndExit()
})

function handle(signal): void {
  logger.info('Signal received', { signal: signal })
  winstonLoggly.flushLogsAndExit()
  process.exit()
}

process.on('SIGINT', handle)
process.on('SIGTERM', handle)
process.on('SIGHUP', handle)
process.on('SIGBREAK', handle)
