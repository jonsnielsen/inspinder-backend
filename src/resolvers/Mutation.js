const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const { randomBytes } = require('crypto');
const { transport, makeANiceEmail } = require('../mail');
const { hasPermission, splitInTwo } = require('../utils/utils');
const { createNewTags, updateTags } = require('../utils/mutations');

const Mutations = {
	async createPost(parent, args, ctx, info) {
		const userId = ctx.request.userId;
		if (!userId) {
			throw new Error('You must be logged in to make a post');
		}
		let containsTags = args.tags && args.tags.length > 0;
		let data = { ...args, user: { connect: { id: userId } } };
		let allTags = [];
		if (containsTags) {
			//1. get all the tags from the user
			let userTags = await ctx.db.query.tags({ where: { user: { id: userId } } });
			//2. go through all of them, seperating then into two lists. the tags that are new and the ones that already exists
			let [ newTags, existingTags ] = splitInTwo(args.tags, userTags, (a, b) => a === b.name);
			//3. create the new tags
			let newTagsDB = await Promise.all(createNewTags({ ctx, info, userId, tags: newTags }));
			//4. concat the two tag lists and create a new post with those
			allTags = newTagsDB.concat(existingTags).map((tag) => ({ id: tag.id }));
			data = { ...data, tags: { connect: allTags } };
		}

		const post = await ctx.db.mutation.createPost({ data }, info);

		//5. update the tags (if there are any) with the post
		if (containsTags) {
			updateTags({
				ctx,
				tags: allTags,
				data: { posts: { connect: { id: post.id } } }
			});
		}

		return post;
	},

	async updatePost(_, args, ctx, info) {
		const { pubsub } = ctx;

		const userId = ctx.request.userId;
		const updates = { ...args };
		const updatedTags = updates.tags;
		let tags = null;
		if (updatedTags) {
			//1. get the posts tags
			const oldPost = await ctx.db.query.post({ where: { id: args.id } }, `{tags{id name}}`);
			//2. find the tags that were deleted
			let deletedTags = oldPost.tags.filter((tag) => !updatedTags.includes(tag.name));
			deletedTags = deletedTags.map((tag) => ({ id: tag.id }));
			//3. find the tags that were added
			const newTags = updatedTags.filter((tag) => !oldPost.tags.some((oldTag) => tag === oldTag.name));
			//3.1 check which of the new tags already are in db.
			let allNewTags = [];
			if (newTags && newTags.length > 0) {
				let userTags = await ctx.db.query.tags({ where: { user: { id: userId } } }, `{id name}`);
				let [ tagsNotInDB, tagsInDB ] = splitInTwo(newTags, userTags, (a, b) => a == b.name);
				//3.2 create the tags that were not
				let newTagsDB =
					newTags.length < 1
						? []
						: await Promise.all(createNewTags({ ctx, info: `{id}`, userId, tags: tagsNotInDB }));
				allNewTags = newTagsDB.concat(tagsInDB).map((tag) => ({ id: tag.id }));
			}
			tags = {
				connect: allNewTags,
				disconnect: deletedTags
			};
		}
		delete updates.id;
		const updatedPost = await ctx.db.mutation.updatePost(
			{
				data: {
					...updates,
					tags
				},
				where: { id: args.id }
			},
			info
		);
		//2.1 publish the tags that were deleted and has no posts so the client can delete them
		if (tags) {
			let deletedTags = [ ...tags.disconnect ];
			if (deletedTags) {
				//foreach tag, get the tag from db, and call publish
				deletedTags.forEach(async (tag) => {
					const tagDB = await ctx.db.query.tag({ where: { id: tag.id } }, `{id name posts{id} user{id}}`);
					//if there are less than 1 posts in the tag, delete the tag
					if (tagDB.posts && tagDB.posts.length < 1) {
						ctx.db.mutation.deleteTag({ where: { id: tagDB.id } });
						//TODO publish the tag that has been deleted so client can update
						// pubsub.publish('PUBSUB_TAG_DELETED', {
						// 	tagWithoutPosts: tagDB
						// });
					}
				});
			}
		}
		return updatedPost;
	},
	async deletePost(parent, args, ctx, info) {
		const where = { id: args.id };
		//1. find the post
		const post = await ctx.db.query.post({ where }, `{id title user{id} tags{id posts{id}}}`);

		//2. if the tags of the posts contains ONE post, then delete it!
		post.tags.forEach((tag) => {
			if (tag.posts.length <= 1) {
				ctx.db.mutation.deleteTag({ where: { id: tag.id } });
			}
		});
		//2. check if they own that item or has that permission
		const ownsPost = post.user.id === ctx.request.userId;
		const hasPermission = ctx.request.user.permissions.some((permission) =>
			[ 'ADMIN', 'ITEMDELETE' ].includes(permission)
		);
		if (!ownsPost && !hasPermission) {
			throw new Error("you don't have permission to delete this post");
		}
		//3. delete post
		return ctx.db.mutation.deletePost({ where }, info);
	},

	async signup(parent, args, ctx, info) {
		args.email = args.email.toLowerCase();
		//hash their password
		const password = await bcrypt.hash(args.password, 11);
		//create the user in db
		const user = await ctx.db.mutation.createUser(
			{
				data: { ...args, password, permissions: { set: [ 'USER' ] } }
			},
			info
		);
		//create JWT token for them
		const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
		//set JWT as a cookie on the response
		//http only because you donnot want javascript to be able to access you cookies because that exposes them
		ctx.response.cookie('token', token, {
			httpOnly: true,
			maxAge: 1000 * 60 * 60 * 24 * 365 //1 year cookie
		});
		//return the user to the browser
		return user;
	},
	async signin(parent, { email, password }, ctx, info) {
		//check if there exists a user with the password
		console.log('trying to signing');
		console.log('email is: ' + email);
		const user = await ctx.db.query.user({ where: { email } });
		if (!user) {
			throw new Error(`No such user found for email ${email}`);
		}
		//check if the passwords matches
		const valid = await bcrypt.compare(password, user.password);
		if (!valid) {
			throw new Error('invalid password');
		}

		//generate JWT token
		const token = jwt.sign({ userId: user.id }, process.env.APP_SECRET);
		//set cookie in the browser
		ctx.response.cookie('token', token, {
			httpOnly: true,
			maxAge: 1000 * 60 * 60 * 24 * 365
		});
		//return the user
		return user;
	},
	signout(parent, args, ctx, info) {
		ctx.response.clearCookie('token');
		return { message: 'signed out' };
	},
	async requestReset(parent, { email }, ctx, info) {
		//1. check if it is a real user
		const user = await ctx.db.query.user({ where: { email } });
		if (!user) {
			throw new Error(`No such user found for email ${email}`);
		}
		//2. set a reset token and expiry
		const resetToken = (await promisify(randomBytes)(20)).toString('hex');
		const resetTokenExpiry = Date.now() + 1000 * 60 * 60;
		const res = ctx.db.mutation.updateUser({
			where: { email },
			data: { resetToken, resetTokenExpiry }
		});
		//3. email them the reset token
		const mailResponse = await transport.sendMail({
			from: 'jonathan@gmail.com',
			to: user.email,
			subjectLine: 'your password reset token',
			html: makeANiceEmail(`your password reset token is here!
       \n\n
       <a href="${process.env.FRONTEND_URL}/reset?resetToken=${resetToken}">Click here to reset </a> `)
		});

		if (!mailResponse) {
			throw new Error('The server was unable to send an email, please try again later!');
		}
		return { message: 'ready for reset' };
	},
	async resetPassword(parent, args, ctx, info) {
		// 1. check if the passwords match
		if (args.password !== args.confirmPassword) {
			throw new Error("Yo Passwords don't match!");
		}
		// 2. check if its a legit reset token
		// 3. Check if its expired
		const [ user ] = await ctx.db.query.users({
			where: {
				resetToken: args.resetToken,
				resetTokenExpiry_gte: Date.now() - 3600000
			}
		});
		if (!user) {
			throw new Error('This token is either invalid or expired!');
		}
		// 4. Hash their new password
		const password = await bcrypt.hash(args.password, 10);
		// 5. Save the new password to the user and remove old resetToken fields
		const updatedUser = await ctx.db.mutation.updateUser({
			where: { email: user.email },
			data: {
				password,
				resetToken: null,
				resetTokenExpiry: null
			}
		});
		// 6. Generate JWT
		const token = jwt.sign({ userId: updatedUser.id }, process.env.APP_SECRET);
		// 7. Set the JWT cookie
		ctx.response.cookie('token', token, {
			httpOnly: true,
			maxAge: 1000 * 60 * 60 * 24 * 365
		});
		// 8. return the new user
		return updatedUser;
	},
	async updatePermissions(parent, args, ctx, info) {
		//1. check if they are loggen in

		if (!ctx.request.userId) {
			throw new Error('you must be logged in');
		}
		//2. query the current user
		const currentUser = await ctx.db.query.user(
			{
				where: { id: ctx.request.userId }
			},
			info
		);
		//3. check if they have permissions to do this
		hasPermission(currentUser, [ 'ADMIN', 'PERMISSIONUPDATE' ]);
		//4. update the permissions

		return ctx.db.mutation.updateUser(
			{
				data: {
					permissions: {
						set: args.permissions
					}
				},
				where: {
					id: args.userId
				}
			},
			info
		);
	}
};

module.exports = Mutations;
