function hasPermission(user, permissionsNeeded) {
	const matchedPermissions = user.permissions.filter((permissionTheyHave) =>
		permissionsNeeded.includes(permissionTheyHave)
	);
	if (!matchedPermissions.length) {
		throw new Error(`You do not have sufficient permissions

      : ${permissionsNeeded}

      You Have:

      ${user.permissions}
      `);
	}
}

///if item in arr1 is contained in arr2 put in 'existing' array. Else in 'new Array'
function splitInTwo(arr1, arr2, compare) {
	let [ newTags, existingTags ] = [ [], [] ];
	arr1.forEach((tag) => {
		let alreadyHere = arr2.find((userTag) => compare(tag, userTag));
		if (alreadyHere) {
			existingTags.push(alreadyHere);
		} else {
			newTags.push(tag);
		}
	});

	return [ newTags, existingTags ];
}

function arrayToSetArray(arr) {
	const dict = {};
	const setArr = [];
	arr.forEach((post) => {
		dict[post.id] = post;
	});
	for (let key in dict) {
		setArr.push(dict[key]);
	}
	return setArr;
}

exports.splitInTwo = splitInTwo;
exports.hasPermission = hasPermission;
exports.arrayToSetArray = arrayToSetArray;
