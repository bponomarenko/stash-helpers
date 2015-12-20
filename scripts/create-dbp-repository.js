var inquirer = require('inquirer');
var Client = require('stash-rest-api').Client;
var git = require('gift');
var fse = require('fs-extra');
var Promise = require('promise');
var querystring = require('query-string');
var https = require('https');

var tempDir = './temp/';
var readmeFile = 'README.md';
var stash, data;

inquirer.prompt([
	{
		name: 'baseUrl',
		message: 'What is the Stash url:',
		'default': 'stash.backbase.com'
	},
	{
		name: 'username',
		message: 'What is the Stash username:'
	},
	{
		name: 'password',
		type: 'password',
		message: 'What is the Stash password:'
	},
	{
		name: 'project',
		message: 'What is the Stash project slug:'
	},
	{
		name: 'repoSlug',
		message: 'What is new Stash repository slug:'
	}
], run);

function run(res) {
	data = res;

	var baseUrl = 'https://' + data.baseUrl + '/rest/api/1.0/';
	stash = new Client(baseUrl, data.username, data.password);
	createRepository();
};

function createRepository() {
	stash.repos.create(data.project, {
		name: data.repoSlug
	})
	.then(function(repo) {
		checkStashError(repo, 'Unable to create Stash repository.');
		return createBranches(repo.cloneUrl);
	})
	.then(setupRepository);
};

function createBranches(cloneUrl) {
	var folderPath = tempDir + data.repoSlug + '/';
	var repo;

	return Promise.denodeify(fse.emptyDir)(tempDir)
		.then(function() {
			return Promise.denodeify(fse.ensureDir)(folderPath);
		})
		.then(function() {
			console.log('Cloning repository');
			return Promise.denodeify(git.clone)(cloneUrl, folderPath, null);
		})
		.then(function(repository){
			console.log('Creating README file');
			repo = repository;
			return Promise.denodeify(fse.ensureFile)(folderPath + readmeFile);
		})
		.then(function(){
			console.log('Staging file');
			return Promise.denodeify(repo.add.bind(repo))(readmeFile, null);
		})
		.then(function(){
			console.log('Commiting files to "master" branch');
			return Promise.denodeify(repo.commit.bind(repo))('Initial commit.', null);
		})
		.then(function(){
			console.log('Pushing master changes');
			return Promise.denodeify(repo.remote_push.bind(repo))('origin', 'master');
		})
		.then(function(){
			console.log('Creating "develop" branch');
			return Promise.denodeify(repo.create_branch.bind(repo))('develop');
		})
		.then(function(){
			console.log('Pushing develop changes');
			return Promise.denodeify(repo.remote_push.bind(repo))('origin', 'develop');
		})
		.catch(function(err) {
			console.error('ERROR: Unable to create initial commit and branches.\n' + err);
		});
};

function setupRepository() {
	var groups = ['development', 'expert services'];
	var users = ['srinivasan', 'dmitrys', 'dragos', 'carlos'];

	return stash.repos.setGroupPermissions(data.project, data.repoSlug, groups, 'READ')
		.then(function(res){
			checkStashError(res, 'Unable to setup repository group permissions.');
			return stash.repos.setUserPermissions(data.project, data.repoSlug, users, 'WRITE');
		})
		.then(function(res) {
			checkStashError(res, 'Unable to setup repository user permissions.');
			return setBranchingModel();
		})
		.then(function() {
			return stash.repos.setDefaultBranch(data.project, data.repoSlug, 'develop');
		})
		.then(function(res) {
			checkStashError(res, 'Unable to setup repository default branch.');
		})
		.catch(function(err) {
			console.error('ERROR: Unable to setup repository.\n' + err);
		});
};

function checkStashError(result, error) {
	if(result.errors) {
		var errorStr = result.errors.map(function(err){
			return err.message;
		}).join('\n');
		
		throw new Error('ERROR: ' + error + '\n' + errorStr);
	}
};

function setBranchingModel() {
	return new Promise(function(resolve, reject) {
		var post_data = querystring.stringify({
			'DEVELOPMENT' : 'refs/heads/develop',
			'PRODUCTION' : 'refs/heads/master',
			'FEATURE-prefix': 'feature/',
			'FEATURE-enabled': 'on',
			'HOTFIX-prefix': 'hotfix/',
			'HOTFIX-enabled': 'on',
			'branch-model-settings-form-submit': 'Save'
		});

		// An object of options to indicate where to post to
		var post_options = {
			host: data.baseUrl,
			path: '/plugins/servlet/branchmodel/projects/' + data.project + '/repos/' + data.repoSlug,
			method: 'POST',
			auth: data.username + ':' + data.password,
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Content-Length': Buffer.byteLength(post_data)
			}
		};

		// Set up the request
		var post_req = https.request(post_options, function(res) {
			res.setEncoding('utf8');
			res.on('data', function() {});
			res.on('end', function () {
				resolve();
			});
		});

		post_req.on('error', function(err) {
			reject('ERROR: Unable to set branching model.\n' + err);
		});

		// post the data
		post_req.write(post_data);
		post_req.end();
	});
};