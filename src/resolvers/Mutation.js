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
		//1. get all the tags from the user
		let userTags = await ctx.db.query.tags({ where: { user: { id: userId } } });
		//2. go through all of them, seperating then into two lists. the tags that are new and the ones that already exists
		let [ newTags, existingTags ] = splitInTwo(args.tags, userTags, (a, b) => a === b.name);
		//3. create the new tags
		let newTagsDB = await Promise.all(createNewTags({ ctx, info, userId, tags: newTags }));
		//4. concat the two tag lists and create a new post with those
		let allTags = newTagsDB.concat(existingTags);
		allTags = allTags.map((tag) => ({ id: tag.id }));
		const data = { ...args, tags: { connect: allTags }, user: { connect: { id: userId } } };
		const post = await ctx.db.mutation.createPost({ data }, info);
		//5. update the tags with the post
		updateTags({
			ctx,
			tags: allTags,
			data: { posts: { connect: { id: post.id } } }
		});

		return post;
	},
	async updatePost(parent, args, ctx, info) {
		const updates = { ...args };
		if (updates.tags) {
			// updates.tags = {set: args.tags}
		}
		delete updates.id;
		return ctx.db.mutation.updatePost(
			{
				data: { ...updates },
				where: { id: args.id }
			},
			info
		);
	},
	async deletePost(parent, args, ctx, info) {
		const where = { id: args.id };
		//1find the post

		const post = await ctx.db.query.post({ where }, `{id title user{id}}`);
		//2check if they own that item or has that permission
		const ownsPost = post.user.is === ctx.request.userId;
		const hasPermission = ctx.request.user.permissions.some((permission) =>
			[ 'ADMIN', 'ITEMDELETE' ].includes(permission)
		);
		if (!ownsPost && !hasPermission) {
			throw new Error("you don't have permission to delete this post");
		}
		//3 delete post
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
