const { forwardTo } = require('prisma-binding');
const { hasPermission } = require('../utils/utils');

const Query = {
	posts: forwardTo('db'),
	post: forwardTo('db'),
	me(parent, args, ctx, info) {
		//check if there is a current user id
		if (!ctx.request.userId) {
			return null;
		}
		return ctx.db.query.user(
			{
				where: { id: ctx.request.userId }
			},
			info
		);
	},
	async users(parent, args, ctx, info) {
		//1. check if the user is loggen in
		if (!ctx.request.userId) {
			throw new Error('you must be logged in');
		}
		//2. check if the user has the permissions to query all users.
		hasPermission(ctx.request.user, [ 'ADMIN', 'PERMISSIONSUPDATE' ]);

		//3. if they do query all the users
		return ctx.db.query.users({}, info);
	},
	tags(parent, { userId, postId }, ctx, info) {
		if (postId) {
			return ctx.db.query.tags({ where: { user: { id: userId }, posts_some: { id: postId } } }, info);
		}
		return ctx.db.query.tags({ where: { user: { id: userId } } }, info);
	}
};

module.exports = Query;
