import jdk.internal.agent.resources.agent
pipeline {
    agent any;
    environment {
        TAG = "${BRANCH_NAME == 'main' ? 'project-omega:main' : "project-omega:branch-${GIT_COMMIT.take(12)}"}"
    }
    stages {
        stage('Build') {
            steps {
                echo "Building ${env.TAG}"
                script {
                    docker.build(env.TAG)
                }
            }
        }
        stage('Unit Tests') {
            agent {
                docker {
                    image TAG
                }
            }
            steps {
                sh '''
                    mkdir -p $WORKSPACE/test-results
                    cd /home/node/app
                    node --test \
                        --test-reporter=junit \
                        --test-reporter-destination="$WORKSPACE/test-results/junit.xml" \
                        tests/*.test.js
                '''
            }
            post {
                always {
                    junit "test-results/junit.xml"
                }
            }
        }
        stage('Test') {
            environment {
                OPENROUTER_API_KEY = credentials('341a4e99-85d0-48d2-94e8-db3b96bf7e12')
                SNARKYTYPE_CLIENT_ID = credentials('b6f17aa7-3444-457d-b176-20b460f8e717')
                SNARKYTYPE_CLIENT_SECRET = credentials('17654df0-6759-48cb-838a-f203495c8fa5')
            }
            steps {
                echo "Testing ${env.TAG}"
                sh '''
                    docker run --rm \
                        -e OPENROUTER_API_KEY \
                        -e SNARKYTYPE_CLIENT_ID \
                        -e SNARKYTYPE_CLIENT_SECRET \
                        "$TAG" \
                        node /home/node/app/scripts/test-ai-bad-word-review.js
                '''
            }
        }
        stage('Deploy') {
            when {
                branch 'main'
            }
            environment {
                OPENROUTER_API_KEY = credentials('341a4e99-85d0-48d2-94e8-db3b96bf7e12')
                SNARKYTYPE_CLIENT_ID = credentials('b6f17aa7-3444-457d-b176-20b460f8e717')
                SNARKYTYPE_CLIENT_SECRET = credentials('17654df0-6759-48cb-838a-f203495c8fa5')
                GOOGLE_TASKS_CLIENT_SECRET = credentials('bfcbaf3c-daf7-405d-86e2-d15c330c63fb')
            }
            steps {
                // I am not proud of this, but for now just tear down and set up the container directly on the agent
                sh '''
                    docker compose -f "deploy/main/docker-compose.yml" up -d
                '''
            }
        }
    }
}
