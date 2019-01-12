const { forwardTo } = require('prisma-binding');
const { hasPermission } = require('../utils/utils');

const Query = {
	posts(_, __, ctx, info) {
		const userId = ctx.request.userId;
		if (!userId) {
			throw new Error('You must be logged in!');
		}
		return ctx.db.query.posts({where: {user: {id: userId} }}, info)
	},
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
	tags(_, __, { db, request }, info) {
		if (!request.userId) {
			throw new Error('you must be logged in');
		}
		return db.query.tags({ where: { user: { id: request.userId } } }, info);
	}
	// tags(_, __,  {db, request}, info) {

	// 	if (postId) {
	// 		return db.query.tags({ where: { user: { id: userId }, posts_some: { id: postId } } }, info);
	// 	}
	// 	return db.query.tags({ where: { user: { id: userId } } }, info);
	// }
};

module.exports = Query;
