import * as React from 'react'
import { AvatarView } from './AvatarView'
import { IGithubComment } from './interfaces'
import { RelativeTime } from './RelativeTime'

export function GithubComment({ comment }: { comment: IGithubComment }) {
  return (
    <li className="comment-block" key={comment.id}>
      <AvatarView userInfo={comment} />
      <div id={`issue-comment-${comment.id}`} className="comment-container">
        <h3 className="header">
          <strong>
            <a href={comment.userUrl} rel="nofollow">{comment.userLogin}</a>
          </strong>
          {' '}commented{' '}
          <a href={`#issue-comment-${comment.id}`} className="timestamp" rel="nofollow">
            <RelativeTime date={comment.createdAt} />
          </a>
          {' '}
          <a href={comment.url} aria-disabled={true} className="view-on-github">
            <i className="fa fa-github"/>
          </a>
        </h3>
        <div className="content">
          <div dangerouslySetInnerHTML={{ __html: comment.body }} className="content-child"/>
        </div>
      </div>
    </li>
  )
}
