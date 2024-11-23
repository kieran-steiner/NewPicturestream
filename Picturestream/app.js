const express = require("express");
const { engine } = require("express-handlebars");
const session = require("express-session");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const path = require("path");

// App-Konfiguration
const app = express();
const db = new sqlite3.Database("./database.sqlite");
const upload = multer({ dest: "public/uploads/" });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: "your_secret_key",
    resave: false,
    saveUninitialized: true,
  })
);

// Handlebars als Template-Engine einrichten
app.engine("hbs", engine({ defaultLayout: "main", extname: ".hbs" }));
app.set("view engine", "hbs");

// Datenbank-Setup
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS pictures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT,
    title TEXT NOT NULL,
    description TEXT,
    user_id INTEGER,
    time DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS users_pictures_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    picture_id INTEGER,
    is_favorite BOOLEAN DEFAULT 0
  )`);
});

// Middleware für Benutzersitzungen
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.redirect("/login");
  }
};

// Routen
app.get("/", (req, res) => res.redirect("/login"));

app.get("/login", (req, res) =>
  res.render("login", { error: req.query.error })
);

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  // Benutzer suchen
  db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
    if (err || !user) {
      res.redirect("/login?error=Benutzername nicht gefunden");
      return;
    }

    // Passwort validieren
    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      res.redirect("/login?error=Ungültige Anmeldedaten");
      return;
    }

    // Benutzer erfolgreich authentifiziert
    req.session.user = { id: user.id, username: user.username };
    res.redirect("/picturestream");
  });
});

app.get("/register", (req, res) =>
  res.render("register", { error: req.query.error })
);

app.post("/register", (req, res) => {
  const { username, email, password } = req.body;

  // Passwort hashen
  const hashedPassword = bcrypt.hashSync(password, 10);

  // Benutzer speichern
  db.run(
    "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
    [username, email, hashedPassword],
    (err) => {
      if (err) {
        res.redirect(
          "/register?error=Benutzername oder E-Mail bereits registriert"
        );
      } else {
        res.redirect("/login");
      }
    }
  );
});

app.get("/picturestream", isAuthenticated, (req, res) => {
  db.all("SELECT * FROM pictures", [], (err, pictures) => {
    res.render("picturestream", { pictures, user: req.session.user });
  });
});

app.get("/mypicturestream", isAuthenticated, (req, res) => {
  db.all(
    `SELECT p.* FROM pictures p
     INNER JOIN users_pictures_favorites f ON p.id = f.picture_id
     WHERE f.user_id = ? AND f.is_favorite = 1`,
    [req.session.user.id],
    (err, pictures) => {
      res.render("mypicturestream", { pictures, user: req.session.user });
    }
  );
});

app.get("/upload", isAuthenticated, (req, res) => res.render("upload"));

app.post("/upload", isAuthenticated, upload.single("picture"), (req, res) => {
  const { title, description } = req.body;

  db.run(
    "INSERT INTO pictures (file_name, title, description, user_id) VALUES (?, ?, ?, ?)",
    [req.file.filename, title, description, req.session.user.id],
    () => {
      res.redirect("/picturestream");
    }
  );
});

app.post("/favorite/:id", isAuthenticated, (req, res) => {
  const pictureId = req.params.id;

  db.run(
    "INSERT INTO users_pictures_favorites (user_id, picture_id, is_favorite) VALUES (?, ?, 1)",
    [req.session.user.id, pictureId],
    () => {
      res.redirect("/picturestream");
    }
  );
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// Server starten
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server läuft auf http://localhost:${PORT}`)
);
