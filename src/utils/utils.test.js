
const {splitInTwo} = require('./utils')

const splitInTwoTestData = [
  // {arr1: [], arr2: [], compFunc: (a,b)=> (a === b), expected: [[],[]]}
  {arr1: [1,2,3], arr2: [3,4,5], compFunc: (a,b)=> (a === b), expected: [[1,2],[3]]},
  {arr1: ["jonathan", "ilse"], arr2: [{name: "jonathan"}, {name: "ilse"}, {name: "ulrikke"}], compFunc: (a,b)=> (a === b.name), expected: [[],[{name: "jonathan"}, {name: "ilse"}]]},
  {arr1: ["jonathan", "ilse"], arr2: [{name: "hula"}, {name: "hopsa"}, {name: "ilse"}], compFunc: (a,b)=> (a === b.name), expected: [["jonathan"],[{name: "ilse"}]]},
  
]
test('splitInTwo given', () => {
  splitInTwoTestData.forEach((testData)=>{
    const {arr1, arr2, compFunc, expected: [expected1, expected2]} = testData;
    const [resultArr1, resultArr2] = splitInTwo(arr1, arr2, compFunc)
    expect(resultArr1).toEqual(expected1);
    expect(resultArr2).toEqual(expected2);

  })
});    
