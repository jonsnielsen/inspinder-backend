
const Subscription = {
	tagWithoutPosts: {
    subscribe: (_,__, {pubsub}) =>  pubsub.asyncIterator('PUBSUB_TAG_DELETED')
	}
};

module.exports = Subscription;
