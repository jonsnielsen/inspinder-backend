function createNewTags({ ctx, tags, userId, info }) {
	let newTagsDB = tags.map(
		async (tagName) =>
			await ctx.db.mutation.createTag(
				{
					data: {
						name: tagName,
						user: { connect: { id: userId } },
						posts: []
					}
				},
				info
			)
	);
	return newTagsDB;
}

function updateTags({ctx,tags, data, info}) {
	tags.forEach((tag) => {
		ctx.db.mutation.updateTag({
			data: data,
			where: { id: tag.id }
		},info);
	});
}

exports.createNewTags = createNewTags;
exports.updateTags = updateTags;
