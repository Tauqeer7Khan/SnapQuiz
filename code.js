import os
import sqlite3
from flask import Flask, request

app = Flask(__name__)

# Hardcoded secret
// KAVACH-FIX: Hardcoded Secret
const DATABASE_PASSWORD = process.env.DATABASE_PASSWORD;
if (!DATABASE_PASSWORD) throw new Error('DATABASE_PASSWORD missing');

const SECRET_KEY = process.env.SECRET_KEY;
if (!SECRET_KEY) throw new Error('SECRET_KEY missing');

@app.route('/user')
def get_user():
    user_id = request.args.get('id')
    # SQL Injection vulnerability
    // KAVACH-FIX: SQL Injection
const query = "SELECT * FROM users WHERE id = ?";
const params = [user_id];
    conn = sqlite3.connect('app.db')
    cursor = conn.execute(query)
    return str(cursor.fetchall())

@app.route('/render')
def render():
    template = request.args.get('template')
    # Command injection
    // KAVACH-FIX: Command Injection
subprocess.run(['cat', template], check=True)
    return "done"