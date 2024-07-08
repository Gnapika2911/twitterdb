const express = require('express');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');

const databasePath = path.join(__dirname, 'twitterClone.db');

const app = express();

app.use(express.json());

let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () =>
      console.log('Server Running at http://localhost:3000/'),
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

// Helper functions to convert database objects to response objects
const convertTweetDbObjectToResponseObject = (dbObject) => {
  return {
    tweet: dbObject.tweet,
    likes: dbObject.likes,
    replies: dbObject.replies,
    dateTime: dbObject.date_time,
  };
};

// Middleware to authenticate JWT token
const authenticateToken = (request, response, next) => {
  const authHeader = request.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return response.status(401).send('Invalid JWT Token');
  }

  jwt.verify(token, 'MY_SECRET_TOKEN', (err, user) => {
    if (err) {
      return response.status(401).send('Invalid JWT Token');
    }
    request.user = user;
    next();
  });
};

// API 1: User Registration
app.post('/register/', async (request, response) => {
  const { name, username, password, gender } = request.body;

  if (password.length < 6) {
    return response.status(400).send('Password is too short');
  }

  try {
    const userExistsQuery = `SELECT * FROM users WHERE username = ?`;
    const existingUser = await database.get(userExistsQuery, [username]);

    if (existingUser) {
      return response.status(400).send('User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const addUserQuery = `
      INSERT INTO users (name, username, password, gender)
      VALUES (${name},${username},${hashedPassword},${gender})
    `;
    await database.run(addUserQuery);

    response.status(200).send('User created successfully');
  } catch (error) {
    console.error('Error registering user:', error);
    response.status(500).send('Internal Server Error');
  }
});

// API 2: User Login
app.post('/login/', async (request, response) => {
  const { username, password } = request.body;

  const selectUserQuery = `SELECT * FROM users WHERE username = ?`;
  const user = await database.get(selectUserQuery, [username]);

  if (!user) {
    return response.status(400).send('Invalid user');
  }

  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) {
    return response.status(400).send('Invalid password');
  }

  const payload = { username: user.username, id: user.user_id };
  const token = jwt.sign(payload, 'MY_SECRET_TOKEN');
  response.send({ jwtToken: token });
});

// API 3: Get User's Tweet Feed
app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const userId = request.user.id;

  const feedQuery = `
    SELECT t.tweet, COUNT(l.like_id) as likes, COUNT(r.reply_id) as replies, t.date_time
    FROM tweets t
    LEFT JOIN likes l ON t.tweet_id = l.tweet_id
    LEFT JOIN replies r ON t.tweet_id = r.tweet_id
    WHERE t.user_id IN (
      SELECT following_user_id FROM followers WHERE follower_user_id = ?
    )
    GROUP BY t.tweet_id
    ORDER BY t.date_time DESC
    LIMIT 4
  `;
  const tweets = await database.all(feedQuery, [userId]);

  response.send(tweets.map(convertTweetDbObjectToResponseObject));
});

// API 4: Get User's Following List
app.get('/user/following/', authenticateToken, async (request, response) => {
  const userId = request.user.id;

  const followingQuery = `
    SELECT u.username
    FROM users u
    JOIN followers f ON u.user_id = f.following_user_id
    WHERE f.follower_user_id = ${userId}
  `;
  const followingList = await database.all(followingQuery);

  response.send(followingList.map((user) => user.username));
});

// API 5: Get User's Followers List
app.get('/user/followers/', authenticateToken, async (request, response) => {
  const userId = request.user.id;

  const followersQuery = `
    SELECT u.username
    FROM users u
    JOIN followers f ON u.user_id = f.follower_user_id
    WHERE f.following_user_id = ${userId}
  `;
  const followersList = await database.all(followersQuery);

  response.send(followersList.map((user) => user.username));
});

// API 6: Get Tweet Details by ID
app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const userId = request.user.id;
  const { tweetId } = request.params;

  const tweetQuery = `
    SELECT t.tweet, COUNT(l.like_id) as likes, COUNT(r.reply_id) as replies, t.date_time
    FROM tweets t
    LEFT JOIN likes l ON t.tweet_id = l.tweet_id
    LEFT JOIN replies r ON t.tweet_id = r.tweet_id
    WHERE t.tweet_id = ${tweetId} AND t.user_id IN (
      SELECT following_user_id FROM followers WHERE follower_user_id = ${userId}
    )
    GROUP BY t.tweet_id
  `;
  const tweet = await database.get(tweetQuery);

  if (!tweet) {
    return response.status(401).send('Invalid Request');
  }

  response.send(convertTweetDbObjectToResponseObject(tweet));
});

// API 7: Get Users who Liked a Tweet
app.get('/tweets/:tweetId/likes/', authenticateToken, async (request, response) => {
  const userId = request.user.id;
  const { tweetId } = request.params;

  const likeQuery = `
    SELECT u.username
    FROM users u
    JOIN likes l ON u.user_id = l.user_id
    WHERE l.tweet_id = ${tweetId} AND l.user_id IN (
      SELECT following_user_id FROM followers WHERE follower_user_id = ${userId}
    )
  `;
  const likes = await database.all(likeQuery);

  if (!likes.length) {
    return response.status(401).send('Invalid Request');
  }

  response.send({ likes: likes.map((like) => like.username) });
});

// API 8: Get Replies to a Tweet
app.get('/tweets/:tweetId/replies/', authenticateToken, async (request, response) => {
  const userId = request.user.id;
  const { tweetId } = request.params;

  const replyQuery = `
    SELECT r.reply, u.username
    FROM replies r
    JOIN users u ON r.user_id = u.user_id
    WHERE r.tweet_id = ${tweetId} AND r.user_id IN (
      SELECT following_user_id FROM followers WHERE follower_user_id = ${userId}
    )
  `;
  const replies = await database.all(replyQuery);

  if (!replies.length) {
    return response.status(401).send('Invalid Request');
  }

  response.send(replies.map((reply) => ({ reply: reply.reply, username: reply.username })));
});

// API 9: Get User's Tweets
app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const userId = request.user.id;

  const userTweetsQuery = `
    SELECT tweet, date_time
    FROM tweets
    WHERE user_id = ${userId}
    ORDER BY date_time DESC
  `;
  const tweets = await database.all(userTweetsQuery);

  response.send(tweets);
});

// API 10: Create a Tweet
app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const userId = request.user.id;
  const { tweet } = request.body;

  const createTweetQuery = `
    INSERT INTO tweets (tweet, user_id, date_time)
    VALUES (${tweet},${userId}, datetime('now'))
  `;
  await database.run(createTweetQuery);

  response.send('Tweet created successfully');
});

// API 11: Delete a Tweet
app.delete('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const userId = request.user.id;
  const { tweetId } = request.params;

  const deleteTweetQuery = `
    DELETE FROM tweets
    WHERE tweet_id = ${tweetId} AND user_id = ${userId}
  `;
  await database.run(deleteTweetQuery);

  response.send('Tweet Removed');
});

module.exports = app;
