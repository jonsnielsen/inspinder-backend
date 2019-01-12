const cookieParser = require("cookie-parser")();
const jwt = require("jsonwebtoken");
require("dotenv").config({ path: "variables.env" });
const createServer = require("./createServer");
const db = require("./db");

const server = createServer();

server.express.use(cookieParser);

//decode the JWT so we can get the user id on each request
server.express.use((req, res, next) => {
  const { token } = req.cookies;
  if (token) {
    const { userId } = jwt.verify(token, process.env.APP_SECRET);
    // put the user id on the request for further requests to accress
    req.userId = userId;
  }
  next();
});

//decode the JWT so we can get the user id on each request
server.express.use(async (req, res, next) => {
  if(!req.userId) {
    return next ();
  }
  const user = await db.query.user({where:{id: req.userId}}, '{id, permissions,email,name}')
  req.user = user;
  next();
});


//start the server
server.start(
  {
    cors: {
      credentials: true,
      origin: process.env.FRONTEND_URL
    }
  },
  deets => {
    console.log(`Server is now running on port http://localhost:${deets.port}`);
  }
);
