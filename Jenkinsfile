import jdk.internal.agent.resources.agent
pipeline {
    agent any;
    stages {
        stage('Build') {
            steps {
                echo 'Building';
                script {
                    docker.build 'project-omega:branch-${env.GIT_BRANCH}-latest'
                }
            }
        }
    }
}
