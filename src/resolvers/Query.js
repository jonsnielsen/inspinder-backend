const { forwardTo } = require('prisma-binding');
const { hasPermission, arrayToSetArray } = require('../utils/utils');

const Query = {
	posts(_, __, ctx, info) {
		const userId = ctx.request.userId;
		if (!userId) {
			throw new Error('You must be logged in!');
		}
		return ctx.db.query.posts({ where: { user: { id: userId } } }, info);
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
	async users(_, __, ctx, info) {
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
	},
	async postsByTags(_, { tagIds }, { db, request }, info) {
		if (!request.userId) {
			throw new Error('You must be logged in!');
		}
		//TODO go through the ids, if the user has read permission, receive the posts.
		//TODO as of this moment, the user blindly receives all posts
		//get all tags
		if (!tagIds || tagIds.length === 0) {
			return db.query.posts({ where: { user: { id: request.userId } } }, info);
		}
		const tags = await Promise.all(
			tagIds.map(async (tagId) => {
				const tag = await db.query.tags(
					{ where: { id: tagId } },
					`{posts {id title link description image tags{id name posts {id}}}}`
					// 	`{
					// 	tag {
					// 		id
					// 		name
					// 		posts {
					// 			title
					// 			link
					// 			description
					// 			image
					// 			tags{
					// 				id
					// 				name
					// 				posts {
					// 					id
					// 				}
					// 			}
					// 		}
					// 	}
					// }`
				);
				// ))[0].posts
				const firstIndex = tag[0];
				const posts = firstIndex.posts;
				return posts;
			})
		);
		// const posts = await Promise.all(tagIds.map(
		// 	async (tagId) => (
		// 		await db.query.posts({where})
		// 	)
		// ))
		// db.query.posts({ where: { tag: { id: request.userId } } }, info);
		const flattened = [].concat.apply([], tags);
		const flattenedSet = arrayToSetArray(flattened);

		return flattenedSet;
	}
};

module.exports = Query;
